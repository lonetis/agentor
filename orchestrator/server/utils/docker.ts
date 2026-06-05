import Docker from 'dockerode';
import type { Duplex } from 'node:stream';
import type { Config } from './config';
import { getAppType } from './apps';
import { renderUserEnvVars } from './user-env-store';
import type { MountConfig, TmuxWindow, AppInstanceInfo, NetworkMode, ExposeApis, UserEnvVars } from '../../shared/types';
import type { StorageManager } from './storage';

export interface EnvironmentJsonPayload {
  networkMode: string;
  allowedDomains: string[];
  dockerEnabled: boolean;
  setupScript: string;
  envVars: string;
  exposeApis: ExposeApis;
}

export interface CapabilityJsonEntry {
  name: string;
  content: string;
}

export interface InstructionJsonEntry {
  name: string;
  content: string;
}

export interface WorkerJsonPayload {
  id: string;
  displayName: string;
  repos: { provider: string; url: string; branch?: string }[];
  initScript: string;
  gitName: string;
  gitEmail: string;
}

/** Runtime image config replicated onto a container created from an *imported*
 * image (`docker import` strips all config), so it boots like the standard
 * worker image. Sourced from the standard image's own config at import time. */
export interface ImageConfigOverride {
  Entrypoint?: string[];
  Cmd?: string[];
  WorkingDir?: string;
  User?: string;
  Env?: string[];
}

/** Subset of the Docker container stats payload the resource monitor reads. */
export interface RawContainerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: { inactive_file?: number; cache?: number };
  };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
  blkio_stats?: { io_service_bytes_recursive?: { op: string; value: number }[] };
}

const MANAGED_LABEL = 'agentor.managed';
/** The worker's UUID `id` — the only identifying label on a worker container.
 * Owner + config live in the WorkerStore record, not in labels. */
const ID_LABEL = 'agentor.id';

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
      useLogger().info(`[docker] created network ${this.config.dockerNetwork}`);
    }
  }

  async createWorkerContainer(opts: {
    /** Owner user id — used for directory paths and env var injection. */
    userId: string;
    /** Worker UUID `id` (immutable internal identity) — used for the `agentor.id`
     * label and the workspace/agents dir leaf. The container's hostname is left
     * to Docker's default (the short container id). */
    id: string;
    /** Globally unique Docker container name (`<prefix>-<id>`). */
    containerName: string;
    cpuLimit?: number;
    memoryLimit?: string;
    mounts?: MountConfig[];
    dockerEnabled?: boolean;
    credentialBinds?: string[];
    environmentJson: EnvironmentJsonPayload;
    capabilitiesJson: CapabilityJsonEntry[];
    instructionsJson: InstructionJsonEntry[];
    workerJson: WorkerJsonPayload;
    storageManager?: StorageManager;
    /** Per-user env vars (agent API keys, GitHub token, custom). Already
     * resolved against the worker owner's account by the container manager. */
    userEnv: UserEnvVars;
    /** Image to run. Defaults to the standard worker image; set to a per-worker
     * imported image (from `docker import`) for restored workers. */
    image?: string;
    /** When false, the container is created but not started (used by import so
     * the volumes can be populated before the entrypoint runs). Defaults to true. */
    start?: boolean;
    /** Runtime config to apply when running an imported image (which has no
     * baked entrypoint/env). Ignored for the standard image. */
    imageConfig?: ImageConfigOverride;
  }): Promise<Docker.Container> {
    const env: string[] = [];

    // When running an imported image (no baked config), seed the base env
    // (PATH, LANG, …) from the original image so binaries resolve.
    if (opts.imageConfig?.Env?.length) env.push(...opts.imageConfig.Env);

    // 4 structured JSON env vars
    env.push(`ENVIRONMENT=${JSON.stringify(opts.environmentJson)}`);
    env.push(`CAPABILITIES=${JSON.stringify(opts.capabilitiesJson)}`);
    env.push(`INSTRUCTIONS=${JSON.stringify(opts.instructionsJson)}`);
    env.push(`WORKER=${JSON.stringify(opts.workerJson)}`);

    // Agent API keys, git provider tokens, and custom env vars — all
    // sourced from the worker owner's per-user account in a single pass
    // via `renderUserEnvVars`. CustomEnvVars entries can override well-known
    // slots using the same KEY.
    for (const line of renderUserEnvVars(opts.userEnv)) env.push(line);

    env.push('ORCHESTRATOR_URL=http://agentor-orchestrator:3000');
    env.push(`WORKER_CONTAINER_NAME=${opts.containerName}`);

    const memBytes = opts.memoryLimit ? this.parseMemoryLimit(opts.memoryLimit) : 0;
    const nanoCpus = opts.cpuLimit ? Math.floor(opts.cpuLimit * 1e9) : 0;

    const binds = (opts.mounts || []).map(
      (m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`
    );

    // Persistent workspace — named volume (volume mode) or host directory under
    // the user's data dir (directory mode).
    if (opts.storageManager) {
      await opts.storageManager.ensureWorkerDirs(opts.userId, opts.id);
      binds.push(opts.storageManager.getWorkerWorkspaceBind(opts.userId, opts.id, opts.containerName));
      binds.push(opts.storageManager.getWorkerAgentsBind(opts.userId, opts.id, opts.containerName));
      if (opts.dockerEnabled) {
        binds.push(opts.storageManager.getWorkerDockerBind(opts.containerName));
      }
    } else {
      binds.push(`${opts.containerName}-workspace:/workspace`);
      binds.push(`${opts.containerName}-agents:/home/agent/.agent-data`);
      if (opts.dockerEnabled) {
        binds.push(`${opts.containerName}-docker:/var/lib/docker`);
      }
    }

    if (opts.credentialBinds?.length) {
      binds.push(...opts.credentialBinds);
    }

    const image = opts.image || this.config.workerImagePrefix + this.config.workerImage;
    await this.ensureImage(image);

    // Add CAP_NET_ADMIN when network restrictions are needed (for iptables)
    // Docker-in-Docker requires --privileged (which implies all caps)
    const networkMode = opts.environmentJson.networkMode;
    const needsNetAdmin = networkMode && networkMode !== 'full';
    const capAdd = needsNetAdmin && !opts.dockerEnabled ? ['NET_ADMIN'] : [];

    const cfg = opts.imageConfig;
    const container = await this.docker.createContainer({
      Image: image,
      name: opts.containerName,
      // Hostname is left unset — Docker defaults it to the short container id
      // (e.g. `16b082a7681b`), so the in-container prompt looks like a normal
      // Docker container. The worker's identity lives in the `agentor.id` label.
      Env: env,
      Tty: true,
      OpenStdin: true,
      // Imported images carry no config — replicate the standard image's
      // entrypoint/cmd/workdir/user so the restored worker boots identically.
      ...(cfg?.Entrypoint ? { Entrypoint: cfg.Entrypoint } : {}),
      ...(cfg?.Cmd ? { Cmd: cfg.Cmd } : {}),
      ...(cfg?.WorkingDir ? { WorkingDir: cfg.WorkingDir } : {}),
      ...(cfg?.User ? { User: cfg.User } : {}),
      Labels: {
        [MANAGED_LABEL]: 'true',
        [ID_LABEL]: opts.id,
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

    if (opts.start !== false) await container.start();
    useLogger().info(`[docker] created container ${opts.containerName}${opts.image ? ` (image ${opts.image})` : ''}`);
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
    windowIndex: number
  ): Promise<{ exec: Docker.Exec; stream: Duplex; tmuxSession: string }> {
    const container = this.docker.getContainer(containerId);
    const tmuxSession = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Each WebSocket gets a linked session (shares windows with 'main' but has
    // its own current-window pointer). Cleaned up explicitly on disconnect.
    const attachExec = await container.exec({
      Cmd: [
        'sh', '-c',
        `tmux new-session -d -t main -s "${tmuxSession}" && { tmux select-window -t "${tmuxSession}:${windowIndex}" 2>/dev/null || true; } && exec tmux attach-session -t "${tmuxSession}"`,
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

    return { exec: attachExec, stream, tmuxSession };
  }

  async killTmuxSession(containerId: string, sessionName: string): Promise<void> {
    try {
      await this.execTmux(containerId, ['kill-session', '-t', sessionName]);
    } catch {}
  }

  async execTmux(containerId: string, args: string[]): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['tmux', ...args],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ Detach: false, Tty: false });
    // Consume stream and wait for it to close (ensures tmux command completes)
    await new Promise<void>((resolve, reject) => {
      (stream as NodeJS.ReadableStream).on('data', () => {});
      (stream as NodeJS.ReadableStream).on('end', resolve);
      (stream as NodeJS.ReadableStream).on('error', reject);
    });
  }

  async execListTmuxWindows(containerId: string): Promise<TmuxWindow[]> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: [
        'tmux',
        'list-windows',
        '-t',
        'main:',
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
    useLogger().debug(`[docker] stopped container ${containerId.slice(0, 12)}`);
  }

  async removeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.remove({ force: true });
    useLogger().debug(`[docker] removed container ${containerId.slice(0, 12)}`);
  }

  async removeVolume(name: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(name);
      await volume.remove();
      useLogger().debug(`[docker] removed volume ${name}`);
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

    const entries: AppInstanceInfo[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean) continue;
      // Tolerate occasional non-JSON stdout lines (e.g. a stray shell warning)
      // so a single bad line doesn't wipe the whole list.
      if (clean[0] !== '{') continue;
      try {
        const parsed = JSON.parse(clean) as Partial<AppInstanceInfo>;
        if (!parsed.id) continue;
        entries.push({
          id: String(parsed.id),
          appType: appTypeId,
          port: typeof parsed.port === 'number' ? parsed.port : parseInt(String(parsed.port ?? 0), 10) || 0,
          status: (parsed.status as AppInstanceInfo['status']) ?? 'stopped',
          ...(parsed.machineName ? { machineName: String(parsed.machineName) } : {}),
          ...(parsed.authUrl ? { authUrl: String(parsed.authUrl) } : {}),
          ...(parsed.authCode ? { authCode: String(parsed.authCode) } : {}),
        });
      } catch {
        // Malformed JSON line — skip.
      }
    }
    return entries;
  }

  async startAppInstance(
    containerId: string,
    appTypeId: string,
    id: string,
    port: number,
    extraArgs: string[] = [],
  ): Promise<void> {
    const output = await this.execAppManage(containerId, appTypeId, ['start', id, String(port), ...extraArgs]);
    this.assertManageOk(output, `start ${appTypeId}/${id}`);
  }

  async stopAppInstance(containerId: string, appTypeId: string, id: string): Promise<void> {
    const output = await this.execAppManage(containerId, appTypeId, ['stop', id]);
    this.assertManageOk(output, `stop ${appTypeId}/${id}`);
  }

  /** Scan NDJSON output from manage.sh and throw if any line signals an error. */
  private assertManageOk(output: string, context: string): void {
    const trimmed = output.trim();
    if (!trimmed) return;
    for (const line of trimmed.split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean || clean[0] !== '{') continue;
      try {
        const parsed = JSON.parse(clean) as { status?: string; message?: string };
        if (parsed.status === 'error') {
          throw new Error(parsed.message || `app manage failed: ${context}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('app manage failed')) throw err;
        // Non-JSON line or parse error — ignore (likely stderr noise).
      }
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

  // --- Generic archive + export/import (worker export/import) ---

  /** Stream a tar of an arbitrary path inside a container. Entries are prefixed
   * with the basename of `path` (e.g. `/workspace` → `workspace/...`). */
  async getArchive(containerId: string, path: string): Promise<NodeJS.ReadableStream> {
    return this.docker.getContainer(containerId).getArchive({ path });
  }

  /** Extract a tar (buffer or stream; gzip auto-detected) into `path` inside a
   * container. `path` is the directory the tar entries are written under. */
  async putArchive(containerId: string, src: Buffer | NodeJS.ReadableStream, path: string): Promise<void> {
    await this.docker.getContainer(containerId).putArchive(src, { path });
  }

  /** Stream the full container filesystem as a tar (`docker export`). Excludes
   * mounted volumes — those are exported separately via `getArchive`. */
  async exportContainer(containerId: string): Promise<NodeJS.ReadableStream> {
    return this.docker.getContainer(containerId).export();
  }

  /** Create a local image from a filesystem tar (`docker import`; gzip auto-
   * detected). Returns once the import progress stream completes. */
  async importImage(src: Buffer | NodeJS.ReadableStream, repo: string, tag: string): Promise<string> {
    const stream = (await this.docker.importImage(src as never, { repo, tag })) as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
    });
    return `${repo}:${tag}`;
  }

  /** Read the runtime config (entrypoint/cmd/workdir/user/env) of an image. */
  async inspectImageConfig(image: string): Promise<ImageConfigOverride> {
    const info = await this.docker.getImage(image).inspect();
    const c = info.Config ?? {};
    return {
      Entrypoint: c.Entrypoint as string[] | undefined,
      Cmd: c.Cmd as string[] | undefined,
      WorkingDir: c.WorkingDir,
      User: c.User,
      Env: c.Env as string[] | undefined,
    };
  }

  async imageExists(image: string): Promise<boolean> {
    try {
      await this.docker.getImage(image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  async removeImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).remove({ force: true });
      useLogger().debug(`[docker] removed image ${image}`);
    } catch {
      // Image may not exist or still be in use — ignore.
    }
  }

  // --- Resource metrics ---

  /** One-shot container stats snapshot (cpu/memory/network/blkio). The Docker
   * engine includes `precpu_stats` so an instantaneous CPU% can be derived from
   * a single call; network/disk rates still need two samples. */
  async getContainerStats(containerId: string): Promise<RawContainerStats> {
    const container = this.docker.getContainer(containerId);
    // dockerode types `stats` as a stream; with `{ stream: false }` it resolves
    // with the parsed JSON object instead.
    return (await container.stats({ stream: false })) as unknown as RawContainerStats;
  }

  /** Total disk (bytes) a worker consumes: the container's writable layer (files
   * written anywhere in the container fs outside volumes — apt installs, /tmp,
   * the home dir outside .agent-data, etc.) plus its `/workspace` and agent-data
   * volumes. The writable layer comes from Docker's computed `SizeRw` (excludes
   * the read-only base image); the volumes are `du`'d inside the container so it
   * works regardless of storage mode. Excludes the Docker-in-Docker volume
   * (the inner image store — a separate concern). Any failure yields 0. */
  async getWorkerDiskUsageBytes(containerId: string): Promise<number> {
    const container = this.docker.getContainer(containerId);

    // Writable layer (the worker's changes to its own filesystem, outside the
    // base image and outside the mounted volumes).
    let writableLayer = 0;
    try {
      // @types/dockerode omits the `size` inspect option (the Docker API supports
      // `?size=true`). Cast the ARGUMENT (not the method — storing the method in a
      // variable would detach its `this` binding and make the call throw) so
      // `container.inspect(...)` still runs as a method and returns SizeRw.
      const info = (await container.inspect({ size: true } as unknown as Docker.ContainerInspectOptions)) as unknown as { SizeRw?: number };
      if (typeof info.SizeRw === 'number' && info.SizeRw > 0) writableLayer = info.SizeRw;
    } catch {
      // size may be unavailable on some drivers — fall back to volumes-only.
    }

    // Worker data volumes (mode-agnostic — du runs at the mount points).
    let volumes = 0;
    try {
      const dirExec = await container.exec({
        // No shell: `timeout` runs `du` directly; the `-c` total line is parsed in JS.
        Cmd: ['timeout', '20', 'du', '-skc', '/workspace', '/home/agent/.agent-data'],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await dirExec.start({ Detach: false, Tty: true });
      const out = await this.streamToString(stream);
      const lines = out.trim().split(/\r?\n/).filter(Boolean);
      const totalLine = [...lines].reverse().find((l) => /\btotal\b/.test(l)) ?? lines[lines.length - 1] ?? '';
      const kb = parseInt(totalLine.trim().split(/\s+/)[0] || '0', 10);
      if (Number.isFinite(kb) && kb > 0) volumes = kb * 1024;
    } catch {
      // keep volumes at 0
    }

    return writableLayer + volumes;
  }

  // --- Helpers ---

  async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      useLogger().info(`[docker] pulling image ${image}...`);
      const stream = await this.docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
      });
      useLogger().info(`[docker] pulled image ${image}`);
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
