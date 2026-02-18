import Docker from 'dockerode';
import type { Config } from './config';
import type { ImageUpdateInfo, UpdateStatus, ApplyResult } from '../../shared/types';

export class UpdateChecker {
  private docker: Docker;
  private config: Config;
  private status: UpdateStatus;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Config) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = config;
    this.status = {
      orchestrator: null,
      mapper: null,
      worker: null,
      isProductionMode: !!config.workerImagePrefix,
    };
  }

  async init(): Promise<void> {
    if (!this.config.workerImagePrefix) return;
    await this.check();
    this.pollInterval = setInterval(() => {
      this.check().catch((err) => {
        console.error('[update-checker] poll error:', err.message || err);
      });
    }, 5 * 60 * 1000);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.config.workerImagePrefix) return this.status;

    const prefix = this.config.workerImagePrefix;
    const orchestratorImage = prefix + this.config.orchestratorImage;
    const mapperImage = prefix + this.config.mapperImage;
    const workerImage = prefix + this.config.workerImage;

    const [orchestrator, mapper, worker] = await Promise.all([
      this.checkImage(orchestratorImage),
      this.checkImage(mapperImage),
      this.checkImage(workerImage),
    ]);

    this.status = {
      orchestrator,
      mapper,
      worker,
      isProductionMode: true,
    };

    const updates = [orchestrator, mapper, worker].filter((i) => i.updateAvailable);
    if (updates.length > 0) {
      console.log(`[update-checker] ${updates.length} update(s) available: ${updates.map((u) => u.name).join(', ')}`);
    }

    return this.status;
  }

  private async checkImage(fullImageName: string): Promise<ImageUpdateInfo> {
    const now = new Date().toISOString();
    try {
      const localDigest = await this.getLocalDigest(fullImageName);
      const remoteDigest = await this.getRemoteDigest(fullImageName);

      return {
        name: fullImageName,
        localDigest,
        remoteDigest,
        updateAvailable: !!localDigest && !!remoteDigest && localDigest !== remoteDigest,
        lastChecked: now,
      };
    } catch (err: unknown) {
      return {
        name: fullImageName,
        localDigest: '',
        remoteDigest: '',
        updateAvailable: false,
        lastChecked: now,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async getLocalDigest(imageName: string): Promise<string> {
    try {
      const image = this.docker.getImage(imageName);
      const info = await image.inspect();
      const repoDigests: string[] = info.RepoDigests || [];
      const repoName = imageName.split(':')[0] ?? '';
      const matching = repoDigests.find((d: string) => d.startsWith(repoName + '@'));
      return matching?.split('@')[1] || '';
    } catch {
      return '';
    }
  }

  private async getRemoteDigest(fullImageName: string): Promise<string> {
    const match = fullImageName.match(/^(.+?)\/(.+):(.+)$/);
    if (!match) return '';
    const [, registry, repo, tag] = match;

    // First get a token for the GHCR registry
    const tokenUrl = `https://${registry}/token?scope=repository:${repo}:pull`;
    const tokenHeaders: Record<string, string> = {};
    if (this.config.githubToken) {
      tokenHeaders['Authorization'] = 'Basic ' + Buffer.from(`token:${this.config.githubToken}`).toString('base64');
    }

    let bearerToken = '';
    try {
      const tokenResp = await fetch(tokenUrl, { headers: tokenHeaders });
      if (tokenResp.ok) {
        const tokenData = await tokenResp.json() as { token?: string };
        bearerToken = tokenData.token || '';
      }
    } catch {
      // Fall back to direct auth
    }

    const url = `https://${registry}/v2/${repo}/manifests/${tag}`;
    const headers: Record<string, string> = {
      'Accept': [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.oci.image.manifest.v1+json',
      ].join(', '),
    };

    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    } else if (this.config.githubToken) {
      headers['Authorization'] = `Bearer ${this.config.githubToken}`;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) return '';

    return resp.headers.get('docker-content-digest') || '';
  }

  async pullImage(imageName: string): Promise<void> {
    const auth = this.config.githubToken
      ? { username: 'token', password: this.config.githubToken }
      : undefined;

    await new Promise<void>((resolve, reject) => {
      this.docker.pull(imageName, { authconfig: auth }, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
        if (err || !stream) return reject(err || new Error('No stream returned'));
        this.docker.modem.followProgress(stream, (err2: Error | null) => {
          if (err2) reject(err2);
          else resolve();
        });
      });
    });
  }

  async applyUpdates(): Promise<ApplyResult> {
    const result: ApplyResult = {
      orchestratorPulled: false,
      mapperPulled: false,
      workerPulled: false,
      orchestratorRestarting: false,
      errors: [],
    };

    if (!this.config.workerImagePrefix) {
      result.errors.push('Not in production mode');
      return result;
    }

    const prefix = this.config.workerImagePrefix;

    // Pull mapper image if update available
    if (this.status.mapper?.updateAvailable) {
      try {
        await this.pullImage(prefix + this.config.mapperImage);
        result.mapperPulled = true;
      } catch (err: unknown) {
        result.errors.push(`Mapper pull failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Pull worker image if update available
    if (this.status.worker?.updateAvailable) {
      try {
        await this.pullImage(prefix + this.config.workerImage);
        result.workerPulled = true;
      } catch (err: unknown) {
        result.errors.push(`Worker pull failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Pull orchestrator image if update available
    if (this.status.orchestrator?.updateAvailable) {
      try {
        await this.pullImage(prefix + this.config.orchestratorImage);
        result.orchestratorPulled = true;
      } catch (err: unknown) {
        result.errors.push(`Orchestrator pull failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return result;
  }

  async recreateOrchestrator(): Promise<void> {
    const hostname = process.env.HOSTNAME;
    if (!hostname) throw new Error('HOSTNAME not set — cannot identify orchestrator container');

    const container = this.docker.getContainer(hostname);
    const info = await container.inspect();
    const newImage = this.config.workerImagePrefix + this.config.orchestratorImage;
    const containerName = info.Name.replace(/^\//, '');

    // Build config for the replacement container
    const createOpts: Docker.ContainerCreateOptions = {
      Image: newImage,
      name: containerName,
      Env: info.Config.Env,
      Labels: info.Config.Labels,
      ExposedPorts: info.Config.ExposedPorts,
      HostConfig: info.HostConfig,
    };

    // Reconstruct network config
    const networks = info.NetworkSettings?.Networks;
    if (networks && Object.keys(networks).length > 0) {
      const endpointsConfig: Record<string, { Aliases?: string[] }> = {};
      for (const [netName, netConfig] of Object.entries(networks)) {
        endpointsConfig[netName] = {
          Aliases: (netConfig as { Aliases?: string[] }).Aliases,
        };
      }
      createOpts.NetworkingConfig = { EndpointsConfig: endpointsConfig };
    }

    console.log(`[update-checker] recreating orchestrator: ${containerName} with image ${newImage}`);

    await container.stop();
    await container.remove();
    const newContainer = await this.docker.createContainer(createOpts);
    await newContainer.start();
  }

}
