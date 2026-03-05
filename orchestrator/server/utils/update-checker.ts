import Docker from 'dockerode';
import type { Config } from './config';
import type { ImageUpdateInfo, UpdateStatus, ApplyResult, UpdatableImage, PruneResult } from '../../shared/types';

interface ImageRef {
  registry: string;
  repo: string;
  tag: string;
}

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
      traefik: null,
      isProductionMode: !!config.workerImagePrefix || config.baseDomains.length > 0,
    };
  }

  async init(): Promise<void> {
    // Always populate local digests so the UI can show image versions
    await this.getLocalImages();

    // In production mode, also check remote digests and start polling
    if (this.config.workerImagePrefix || this.config.baseDomains.length > 0) {
      await this.check();
      this.pollInterval = setInterval(() => {
        this.check().catch((err) => {
          console.error('[update-checker] poll error:', err.message || err);
        });
      }, 5 * 60 * 1000);
    }
  }

  private async getLocalImages(): Promise<void> {
    const prefix = this.config.workerImagePrefix;
    const images: { key: keyof Pick<UpdateStatus, 'orchestrator' | 'mapper' | 'worker' | 'traefik'>; name: string }[] = [
      { key: 'orchestrator', name: (prefix || '') + this.config.orchestratorImage },
      { key: 'mapper', name: (prefix || '') + this.config.mapperImage },
      { key: 'worker', name: (prefix || '') + this.config.workerImage },
      { key: 'traefik', name: this.config.traefikImage },
    ];

    const now = new Date().toISOString();
    for (const { key, name } of images) {
      const localDigest = await this.getLocalDigest(name);
      this.status[key] = {
        name,
        localDigest,
        remoteDigest: '',
        updateAvailable: false,
        lastChecked: now,
      };
    }
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async check(): Promise<UpdateStatus> {
    const prefix = this.config.workerImagePrefix;
    const hasPrefix = !!prefix;
    const hasBaseDomains = this.config.baseDomains.length > 0;

    if (!hasPrefix && !hasBaseDomains) return this.status;

    const checks: Promise<ImageUpdateInfo | null>[] = [];

    if (hasPrefix) {
      checks.push(
        this.checkImage(prefix + this.config.orchestratorImage),
        this.checkImage(prefix + this.config.mapperImage),
        this.checkImage(prefix + this.config.workerImage),
      );
    } else {
      checks.push(
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve(null),
      );
    }

    if (hasBaseDomains) {
      checks.push(this.checkImage(this.config.traefikImage));
    } else {
      checks.push(Promise.resolve(null));
    }

    const results = await Promise.all(checks);

    this.status = {
      orchestrator: results[0] ?? null,
      mapper: results[1] ?? null,
      worker: results[2] ?? null,
      traefik: results[3] ?? null,
      isProductionMode: hasPrefix || hasBaseDomains,
    };

    const updates = results.filter((i) => i?.updateAvailable);
    if (updates.length > 0) {
      console.log(`[update-checker] ${updates.length} update(s) available: ${updates.map((u) => u!.name).join(', ')}`);
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

  private parseImageRef(fullImageName: string): ImageRef {
    // ghcr.io/org/repo:tag
    const ghcrMatch = fullImageName.match(/^(ghcr\.io)\/(.+):(.+)$/);
    if (ghcrMatch) {
      return { registry: ghcrMatch[1]!, repo: ghcrMatch[2]!, tag: ghcrMatch[3]! };
    }

    // registry.host/path:tag (any explicit registry)
    const explicitMatch = fullImageName.match(/^([^/]+\.[^/]+)\/(.+):(.+)$/);
    if (explicitMatch) {
      return { registry: explicitMatch[1]!, repo: explicitMatch[2]!, tag: explicitMatch[3]! };
    }

    // user/repo:tag (Docker Hub)
    const userMatch = fullImageName.match(/^([^/]+\/[^/]+):(.+)$/);
    if (userMatch) {
      return { registry: 'registry-1.docker.io', repo: userMatch[1]!, tag: userMatch[2]! };
    }

    // official image: traefik:v3 -> library/traefik:v3
    const officialMatch = fullImageName.match(/^([^/:]+):(.+)$/);
    if (officialMatch) {
      return { registry: 'registry-1.docker.io', repo: `library/${officialMatch[1]}`, tag: officialMatch[2]! };
    }

    // Bare name without tag
    return { registry: 'registry-1.docker.io', repo: fullImageName.includes('/') ? fullImageName : `library/${fullImageName}`, tag: 'latest' };
  }

  private async getRegistryToken(ref: ImageRef): Promise<string> {
    if (ref.registry === 'ghcr.io') {
      const tokenUrl = `https://ghcr.io/token?scope=repository:${ref.repo}:pull`;
      const headers: Record<string, string> = {};
      if (this.config.githubToken) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`token:${this.config.githubToken}`).toString('base64');
      }
      try {
        const resp = await fetch(tokenUrl, { headers });
        if (resp.ok) {
          const data = await resp.json() as { token?: string };
          return data.token || '';
        }
      } catch {
        // Fall through
      }
      return '';
    }

    // Docker Hub (registry-1.docker.io)
    const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${ref.repo}:pull`;
    try {
      const resp = await fetch(tokenUrl);
      if (resp.ok) {
        const data = await resp.json() as { token?: string };
        return data.token || '';
      }
    } catch {
      // Fall through
    }
    return '';
  }

  private async getLocalDigest(imageName: string): Promise<string> {
    try {
      const image = this.docker.getImage(imageName);
      const info = await image.inspect();
      const repoDigests: string[] = info.RepoDigests || [];
      const repoName = imageName.split(':')[0] ?? '';

      // Try exact prefix match first (works for GHCR: ghcr.io/org/repo@sha256:...)
      const matching = repoDigests.find((d: string) => d.startsWith(repoName + '@'));
      if (matching) return matching.split('@')[1] || '';

      // Fallback: Docker Hub images may have fully-qualified RepoDigests
      // e.g. imageName="traefik:v3" but RepoDigest="docker.io/library/traefik@sha256:..."
      const ref = this.parseImageRef(imageName);
      const qualifiedPrefix = ref.registry === 'registry-1.docker.io'
        ? `docker.io/${ref.repo}@`
        : `${ref.registry}/${ref.repo}@`;
      const qualifiedMatch = repoDigests.find((d: string) => d.startsWith(qualifiedPrefix));
      if (qualifiedMatch) return qualifiedMatch.split('@')[1] || '';

      // Last resort: use first digest entry
      const firstDigest = repoDigests.find((d: string) => d.includes('@'));
      return firstDigest?.split('@')[1] || '';
    } catch {
      return '';
    }
  }

  private async getRemoteDigest(fullImageName: string): Promise<string> {
    const ref = this.parseImageRef(fullImageName);
    const token = await this.getRegistryToken(ref);

    const url = `https://${ref.registry}/v2/${ref.repo}/manifests/${ref.tag}`;
    const headers: Record<string, string> = {
      'Accept': [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.oci.image.manifest.v1+json',
      ].join(', '),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (ref.registry === 'ghcr.io' && this.config.githubToken) {
      headers['Authorization'] = `Bearer ${this.config.githubToken}`;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) return '';

    return resp.headers.get('docker-content-digest') || '';
  }

  async pullImage(imageName: string): Promise<void> {
    const ref = this.parseImageRef(imageName);
    const isGhcr = ref.registry === 'ghcr.io';

    const auth = isGhcr && this.config.githubToken
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

  async applyUpdates(images?: UpdatableImage[]): Promise<ApplyResult> {
    const result: ApplyResult = {
      orchestratorPulled: false,
      mapperPulled: false,
      workerPulled: false,
      traefikPulled: false,
      orchestratorRestarting: false,
      errors: [],
    };

    const hasPrefix = !!this.config.workerImagePrefix;
    const hasBaseDomains = this.config.baseDomains.length > 0;

    if (!hasPrefix && !hasBaseDomains) {
      result.errors.push('Not in production mode');
      return result;
    }

    const shouldUpdate = (key: UpdatableImage) => !images || images.includes(key);
    const prefix = this.config.workerImagePrefix;

    // Pull mapper image if update available
    if (hasPrefix && shouldUpdate('mapper') && this.status.mapper?.updateAvailable) {
      try {
        await this.pullImage(prefix + this.config.mapperImage);
        result.mapperPulled = true;
      } catch (err: unknown) {
        result.errors.push(`Mapper pull failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Pull worker image if update available
    if (hasPrefix && shouldUpdate('worker') && this.status.worker?.updateAvailable) {
      try {
        await this.pullImage(prefix + this.config.workerImage);
        result.workerPulled = true;
      } catch (err: unknown) {
        result.errors.push(`Worker pull failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Pull Traefik image if update available
    if (hasBaseDomains && shouldUpdate('traefik') && this.status.traefik?.updateAvailable) {
      try {
        await this.pullImage(this.config.traefikImage);
        result.traefikPulled = true;
      } catch (err: unknown) {
        result.errors.push(`Traefik pull failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Pull orchestrator image if update available
    if (hasPrefix && shouldUpdate('orchestrator') && this.status.orchestrator?.updateAvailable) {
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
    const tempName = `${containerName}-next`;
    const swapperName = `${containerName}-swapper`;

    // Build config for the replacement container (temp name — ports would conflict)
    const createOpts: Docker.ContainerCreateOptions = {
      Image: newImage,
      name: tempName,
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

    // Clean up leftover containers from a previous failed attempt
    await this.removeContainerIfExists(tempName);
    await this.removeContainerIfExists(swapperName);

    // Create replacement container (not started — host port bindings would conflict)
    const newContainer = await this.docker.createContainer(createOpts);

    // Delegate the stop→remove→rename→start sequence to a one-shot swapper container.
    // We can't do this in-process because stopping our own container kills this process.
    const swapScript = [
      'const http = require("http");',
      'function api(method, path) {',
      '  return new Promise((resolve, reject) => {',
      '    const req = http.request({ socketPath: "/var/run/docker.sock", method, path }, (res) => {',
      '      let d = ""; res.on("data", c => d += c);',
      '      res.on("end", () => resolve({ status: res.statusCode, data: d }));',
      '    });',
      '    req.on("error", reject);',
      '    req.end();',
      '  });',
      '}',
      '(async () => {',
      `  console.log("[swapper] stopping ${containerName}...");`,
      `  await api("POST", "/containers/${containerName}/stop?t=30");`,
      `  await api("POST", "/containers/${containerName}/wait");`,
      `  console.log("[swapper] removing old container...");`,
      `  await api("DELETE", "/containers/${containerName}");`,
      `  console.log("[swapper] renaming ${tempName} -> ${containerName}...");`,
      `  await api("POST", "/containers/${newContainer.id}/rename?name=${containerName}");`,
      `  console.log("[swapper] starting new orchestrator...");`,
      `  const r = await api("POST", "/containers/${newContainer.id}/start");`,
      '  if (r.status < 300) console.log("[swapper] orchestrator replaced successfully");',
      '  else { console.error("[swapper] start failed:", r.status, r.data); process.exit(1); }',
      '})().catch(e => { console.error("[swapper] fatal:", e.message || e); process.exit(1); });',
    ].join('\n');

    const swapper = await this.docker.createContainer({
      Image: newImage,
      name: swapperName,
      Cmd: ['node', '-e', swapScript],
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        AutoRemove: true,
        NetworkMode: 'none',
      },
    });

    await swapper.start();
    console.log('[update-checker] swapper started — orchestrator will be replaced shortly');
  }

  async pruneImages(): Promise<PruneResult> {
    const res = await this.docker.pruneImages({ filters: { dangling: ['false'] } });
    return {
      imagesDeleted: res.ImagesDeleted?.length ?? 0,
      spaceReclaimed: res.SpaceReclaimed ?? 0,
    };
  }

  private async removeContainerIfExists(name: string): Promise<void> {
    try {
      await this.docker.getContainer(name).remove({ force: true });
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }

}
