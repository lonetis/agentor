import Docker from 'dockerode';
import type { Duplex } from 'node:stream';
import type { Config } from './config';
import { getAppType } from './apps';
import { listGitProviders } from './git-providers';
import type { NetworkMode, MountConfig, RepoConfig, TmuxWindow, AppInstanceInfo } from '../../shared/types';

const MANAGED_LABEL = 'agentor.managed';

export class DockerService {
  private docker: Docker;
  private config: Config;

  constructor(config: Config) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = config;
  }

  async ensureNetwork(): Promise<void> {
    const networks = await this.docker.listNetworks({
      filters: { name: [this.config.dockerNetwork] },
    });
    if (networks.length === 0) {
      await this.docker.createNetwork({
        Name: this.config.dockerNetwork,
        Driver: 'bridge',
      });
    }
  }

  async createWorkerContainer(opts: {
    name: string;
    displayName?: string;
    repos?: RepoConfig[];
    cpuLimit?: number;
    memoryLimit?: string;
    mounts?: MountConfig[];
    networkMode?: NetworkMode;
    allowedDomains?: string[];
    setupScriptB64?: string;
    initScriptB64?: string;
    customEnvVars?: string[];
    dockerEnabled?: boolean;
    credentialBinds?: string[];
    environmentId?: string;
    environmentName?: string;
  }): Promise<Docker.Container> {
    const env: string[] = [];

    if (opts.repos?.length) {
      env.push(`REPOS=${JSON.stringify(opts.repos)}`);
    }

    // Pass token env vars for all configured git providers
    for (const provider of listGitProviders()) {
      const token = this.config[provider.tokenConfigKey as keyof Config];
      if (token) {
        env.push(`${provider.tokenEnvVar}=${token}`);
      }
    }

    // Environment-specific env vars
    if (opts.networkMode) {
      env.push(`NETWORK_MODE=${opts.networkMode}`);
    }
    if (opts.allowedDomains?.length) {
      env.push(`ALLOWED_DOMAINS=${JSON.stringify(opts.allowedDomains)}`);
    }
    if (opts.setupScriptB64) {
      env.push(`SETUP_SCRIPT_B64=${opts.setupScriptB64}`);
    }
    if (opts.initScriptB64) {
      env.push(`INIT_SCRIPT_B64=${opts.initScriptB64}`);
    }
    if (opts.dockerEnabled) {
      env.push('DOCKER_ENABLED=true');
    }
    if (opts.customEnvVars?.length) {
      for (const v of opts.customEnvVars) {
        env.push(v);
      }
    }

    const memBytes = opts.memoryLimit ? this.parseMemoryLimit(opts.memoryLimit) : 0;
    const nanoCpus = opts.cpuLimit ? Math.floor(opts.cpuLimit * 1e9) : 0;

    const binds = (opts.mounts || []).map(
      (m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`
    );

    // Persistent workspace volume — data survives container removal
    binds.push(`${opts.name}-workspace:/workspace`);

    // Docker-in-Docker: mount a named volume for /var/lib/docker so overlay2 works
    // (overlay2 cannot nest on the container's overlayfs root, but a Docker volume
    // is backed by the host filesystem). Data persists across container restarts.
    if (opts.dockerEnabled) {
      binds.push(`${opts.name}-docker:/var/lib/docker`);
    }

    // Credential file bind mounts (OAuth tokens shared across all workers)
    if (opts.credentialBinds?.length) {
      binds.push(...opts.credentialBinds);
    }

    const image = this.config.workerImagePrefix + this.config.workerImage;
    await this.ensureImage(image);

    // Add CAP_NET_ADMIN when network restrictions are needed (for iptables)
    // Docker-in-Docker requires --privileged (which implies all caps)
    const needsNetAdmin = opts.networkMode && opts.networkMode !== 'full';
    const capAdd = needsNetAdmin && !opts.dockerEnabled ? ['NET_ADMIN'] : [];

    const container = await this.docker.createContainer({
      Image: image,
      name: opts.name,
      Env: env,
      Tty: true,
      OpenStdin: true,
      Labels: {
        [MANAGED_LABEL]: 'true',
        'agentor.created': new Date().toISOString(),
        ...(opts.displayName ? { 'agentor.display-name': opts.displayName } : {}),
        ...(opts.repos?.length ? { 'agentor.repos': JSON.stringify(opts.repos) } : {}),
        ...(opts.cpuLimit ? { 'agentor.cpu-limit': String(opts.cpuLimit) } : {}),
        ...(opts.memoryLimit ? { 'agentor.memory-limit': opts.memoryLimit } : {}),
        ...(opts.networkMode && opts.networkMode !== 'full' ? { 'agentor.network-mode': opts.networkMode } : {}),
        ...(opts.dockerEnabled ? { 'agentor.docker-enabled': 'true' } : {}),
        ...(opts.environmentId ? { 'agentor.environment-id': opts.environmentId } : {}),
        ...(opts.environmentName ? { 'agentor.environment-name': opts.environmentName } : {}),
      },
      HostConfig: {
        NetworkMode: this.config.dockerNetwork,
        ...(nanoCpus > 0 ? { NanoCpus: nanoCpus } : {}),
        ...(memBytes > 0 ? { Memory: memBytes } : {}),
        ...(capAdd.length > 0 ? { CapAdd: capAdd } : {}),
        ...(opts.dockerEnabled ? { Privileged: true } : {}),
        Init: true,
        RestartPolicy: { Name: 'unless-stopped' },
        ShmSize: 512 * 1024 * 1024,
        Binds: binds.length > 0 ? binds : undefined,
      },
    });

    await container.start();
    return container;
  }

  async listContainers(): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({
      all: true,
      filters: { label: [`${MANAGED_LABEL}=true`] },
    });
  }

  async execAttachTmuxWindow(
    containerId: string,
    windowName: string
  ): Promise<{ exec: Docker.Exec; stream: Duplex }> {
    const container = this.docker.getContainer(containerId);

    // Each WebSocket gets a linked session (shares windows with 'main' but has
    // its own current-window pointer). destroy-unattached auto-cleans on disconnect.
    const safeWindow = windowName.replace(/[^a-zA-Z0-9_-]/g, '');
    const attachExec = await container.exec({
      Cmd: [
        'sh', '-c',
        `SID=ws-$$; tmux new-session -d -t main -s "$SID" && { tmux select-window -t "$SID:${safeWindow}" 2>/dev/null || true; } && exec tmux attach-session -t "$SID" ';' set-option destroy-unattached on`,
      ],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const stream = (await attachExec.start({
      Detach: false,
      Tty: true,
      hijack: true,
      stdin: true,
    })) as Duplex;

    return { exec: attachExec, stream };
  }

  async execTmux(containerId: string, args: string[]): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['tmux', ...args],
      AttachStdout: true,
      AttachStderr: true,
    });
    await exec.start({ Detach: false, Tty: true });
  }

  async execListTmuxWindows(containerId: string): Promise<TmuxWindow[]> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: [
        'tmux',
        'list-windows',
        '-t',
        'main',
        '-F',
        '#{window_index}:#{window_name}:#{window_active}',
      ],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false, Tty: true });
    const output = await this.streamToString(stream);

    return output
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(':');
        return {
          index: parseInt(parts[0] ?? '0', 10),
          name: parts[1] ?? '',
          active: parts[2] === '1',
        };
      });
  }

  async resizeExec(execId: string, cols: number, rows: number): Promise<void> {
    const exec = this.docker.getExec(execId);
    await exec.resize({ h: rows, w: cols });
  }

  async getLogs(
    containerId: string,
    tail: number = 200
  ): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
    });
    return logs.toString();
  }

  async stopContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.stop();
  }

  async removeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.remove({ force: true });
  }

  async removeVolume(name: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(name);
      await volume.remove();
    } catch {
      // Volume may not exist — ignore
    }
  }

  async restartContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.restart();
  }

  // --- Generic app instance management (runs in worker container) ---

  async execAppManage(containerId: string, appTypeId: string, args: string[]): Promise<string> {
    const appType = getAppType(appTypeId);
    if (!appType) throw new Error(`Unknown app type: ${appTypeId}`);

    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: [`/home/agent/apps/${appType.manageScript}`, ...args],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ Detach: false, Tty: true });
    return this.streamToString(stream);
  }

  async listAppInstances(containerId: string, appTypeId: string): Promise<AppInstanceInfo[]> {
    const output = await this.execAppManage(containerId, appTypeId, ['list']);
    const trimmed = output.trim();
    if (!trimmed) return [];

    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(':');
        return {
          id: parts[0] ?? '',
          appType: appTypeId,
          port: parseInt(parts[1] ?? '0', 10),
          status: (parts[2] ?? 'stopped') as 'running' | 'stopped',
        };
      });
  }

  async startAppInstance(containerId: string, appTypeId: string, id: string, port: number): Promise<string> {
    const output = await this.execAppManage(containerId, appTypeId, ['start', id, String(port)]);
    const trimmed = output.trim();
    if (trimmed.startsWith('ERR:')) {
      throw new Error(trimmed.substring(4));
    }
    return trimmed;
  }

  async stopAppInstance(containerId: string, appTypeId: string, id: string): Promise<void> {
    const output = await this.execAppManage(containerId, appTypeId, ['stop', id]);
    const trimmed = output.trim();
    if (trimmed.startsWith('ERR:')) {
      throw new Error(trimmed.substring(4));
    }
  }

  // --- Workspace archive methods ---

  async putWorkspaceArchive(containerId: string, tarBuffer: Buffer): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.putArchive(tarBuffer, { path: '/workspace' });
  }

  async getWorkspaceArchive(containerId: string): Promise<NodeJS.ReadableStream> {
    const container = this.docker.getContainer(containerId);
    return container.getArchive({ path: '/workspace' });
  }

  // --- Helpers ---

  async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      console.log(`[docker] pulling image ${image}...`);
      const stream = await this.docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
      });
      console.log(`[docker] pulled image ${image}`);
    }
  }

  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+(?:\.\d+)?)\s*(b|k|m|g|kb|mb|gb)$/i);
    if (!match) throw new Error(`Invalid memory limit: ${limit}`);
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();
    const multipliers: Record<string, number> = {
      b: 1,
      k: 1024,
      kb: 1024,
      m: 1024 ** 2,
      mb: 1024 ** 2,
      g: 1024 ** 3,
      gb: 1024 ** 3,
    };
    return Math.floor(value * (multipliers[unit] || 1));
  }

  private streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      stream.on('error', reject);
    });
  }
}
