import Docker from 'dockerode';
import { mkdir, rm, chown, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Config } from './config';

type StorageMode = 'volume' | 'directory';

const AGENT_UID = 1000;
const AGENT_GID = 1000;

/** Relative paths inside a worker's agents directory where the orchestrator
 * pre-creates empty mountpoint files. Docker Desktop's virtiofs refuses to
 * nest a file bind mount inside a directory bind mount unless the target
 * already exists on the host, so we touch these files before starting the
 * container and then bind the per-user credential file on top. */
const CREDENTIAL_MOUNT_POINTS = [
  '.claude/.credentials.json',
  '.codex/auth.json',
  '.gemini/oauth_creds.json',
];

export class StorageManager {
  private docker: Docker;
  private config: Config;

  mode: StorageMode = 'volume';
  /** Volume name (volume mode) or host path (directory mode) — used in bind strings
   * that Docker interprets via name or path depending on the first character. */
  dataRef = '';
  /** Absolute host path of the data directory — always a filesystem path, even
   * in volume mode (`/var/lib/docker/volumes/<volume>/_data`). Used to build
   * file-level bind mounts for per-user credentials. Empty if resolution failed. */
  dataHostPath = '';
  /** In-container path for fs operations (always /data) */
  dataDir: string;

  constructor(docker: Docker, config: Config) {
    this.docker = docker;
    this.config = config;
    this.dataDir = config.dataDir;
  }

  async init(): Promise<void> {
    const hostname = process.env.HOSTNAME;
    if (!hostname) {
      useLogger().info('[storage] HOSTNAME not set — falling back to volume mode');
      this.mode = 'volume';
      this.dataRef = this.config.dataVolume;
      return;
    }

    try {
      const container = this.docker.getContainer(hostname);
      const info = await container.inspect();

      const dataMount = info.Mounts?.find(
        (m: { Destination: string }) => m.Destination === this.dataDir
      );

      if (!dataMount) {
        useLogger().info('[storage] /data not mounted — falling back to volume mode');
        this.mode = 'volume';
        this.dataRef = this.config.dataVolume;
        return;
      }

      if (dataMount.Type === 'bind') {
        this.mode = 'directory';
        this.dataRef = dataMount.Source;
        this.dataHostPath = dataMount.Source;
        useLogger().info(`[storage] directory mode — host path: ${this.dataRef}`);
      } else {
        this.mode = 'volume';
        this.dataRef = dataMount.Name || this.config.dataVolume;
        // Docker surfaces the volume's host data dir as Source for volume mounts.
        this.dataHostPath = dataMount.Source || '';
        useLogger().info(
          `[storage] volume mode — volume: ${this.dataRef}${this.dataHostPath ? ` (host path: ${this.dataHostPath})` : ''}`,
        );
      }
    } catch (err: unknown) {
      useLogger().error(`[storage] init failed, falling back to volume mode: ${err instanceof Error ? err.message : err}`);
      this.mode = 'volume';
      this.dataRef = this.config.dataVolume;
    }
  }

  /** Bind string for mounting the data directory (used by Traefik) */
  getDataBind(readOnly = false): string {
    const suffix = readOnly ? ':ro' : '';
    return `${this.dataRef}:/data${suffix}`;
  }

  /** Bind string for a worker's workspace. Directory mode nests the path inside
   * the user's data dir so per-user name collisions do not clash on disk. */
  getWorkerWorkspaceBind(userId: string, name: string, containerName: string): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'users', userId, 'workspaces', name)}:/workspace`;
    }
    return `${containerName}-workspace:/workspace`;
  }

  /** Bind string for a worker's Docker-in-Docker data (always a named volume — overlay2 requires a native filesystem) */
  getWorkerDockerBind(containerName: string): string {
    return `${containerName}-docker:/var/lib/docker`;
  }

  /** Bind string for a worker's persistent agent config data (~/.claude, ~/.gemini, ~/.codex, ~/.agents) */
  getWorkerAgentsBind(userId: string, name: string, containerName: string): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'users', userId, 'agents', name)}:/home/agent/.agent-data`;
    }
    return `${containerName}-agents:/home/agent/.agent-data`;
  }

  /** Bind string for Traefik certificate storage */
  getCertBind(): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'traefik-certs')}:/letsencrypt`;
    }
    return 'agentor-traefik-certs:/letsencrypt';
  }

  /** Ensure workspace and agents directories exist with correct ownership,
   * and pre-create the credential mountpoint files so Docker Desktop's virtiofs
   * can layer per-user credential file binds on top (directory mode only). */
  async ensureWorkerDirs(userId: string, name: string): Promise<void> {
    if (this.mode !== 'directory') return;

    const userDir = this.getUserDir(userId);
    await mkdir(userDir, { recursive: true });
    await this.chownDir(userDir);

    const workspaceDir = join(userDir, 'workspaces', name);
    await mkdir(workspaceDir, { recursive: true });
    await this.chownDir(workspaceDir);

    const agentsDir = join(userDir, 'agents', name);
    await mkdir(agentsDir, { recursive: true });
    await this.chownDir(agentsDir);

    for (const relPath of CREDENTIAL_MOUNT_POINTS) {
      const mountpoint = join(agentsDir, relPath);
      const parent = dirname(mountpoint);
      await mkdir(parent, { recursive: true });
      await this.chownDir(parent);
      try {
        await stat(mountpoint);
      } catch {
        await writeFile(mountpoint, '', { mode: 0o600 });
        try {
          await chown(mountpoint, AGENT_UID, AGENT_GID);
        } catch {
          // See chownDir — best effort.
        }
      }
    }
  }

  /** Ensure the per-user SSH directory + `authorized_keys` file exist so the
   * bind mount target is valid before a worker starts. Idempotent. Writes via
   * the in-container data path so it works in both volume and directory mode;
   * the file surfaces on the host at `<dataHostPath>/users/<userId>/ssh/…`,
   * which is what the Docker bind string references. */
  async ensureUserSshDir(userId: string): Promise<void> {
    const sshDir = join(this.dataDir, 'users', userId, 'ssh');
    const keyFile = join(sshDir, 'authorized_keys');
    await mkdir(sshDir, { recursive: true });
    try {
      await stat(keyFile);
    } catch {
      await writeFile(keyFile, '', { mode: 0o644 });
    }
  }

  /** Bind string for the user's `authorized_keys` file, mounted read-only at
   * the path sshd reads from inside the worker. Resolved via the host path so
   * Docker can find the file regardless of storage mode. */
  getSshAuthorizedKeysBind(userId: string): string {
    if (!this.dataHostPath) {
      throw new Error('[storage] dataHostPath not resolved — cannot build ssh bind');
    }
    const hostFile = join(this.dataHostPath, 'users', userId, 'ssh', 'authorized_keys');
    return `${hostFile}:/home/agent/.ssh/authorized_keys:ro`;
  }

  /** In-container path of a user's private data directory (`/data/users/<userId>/`). */
  getUserDir(userId: string): string {
    return join(this.dataDir, 'users', userId);
  }

  /** Host path of a user's data directory, for constructing Docker bind strings.
   * Only valid when `dataHostPath` was resolved successfully at init. */
  getUserHostDir(userId: string): string {
    if (!this.dataHostPath) {
      throw new Error('[storage] dataHostPath not resolved — cannot build per-user host path');
    }
    return join(this.dataHostPath, 'users', userId);
  }

  /** Ensure a user's data + credentials directories exist with correct ownership
   * (directory mode only — volume mode relies on the entrypoint's chown). */
  async ensureUserDir(userId: string): Promise<void> {
    const userDir = this.getUserDir(userId);
    const credDir = join(userDir, 'credentials');
    await mkdir(credDir, { recursive: true });
    if (this.mode === 'directory') {
      await this.chownDir(userDir);
      await this.chownDir(credDir);
    }
  }

  /** Remove a user's entire data directory (credentials, workers, mappings,
   * env vars, usage, workspaces, agents — everything). */
  async removeUserDir(userId: string): Promise<void> {
    await rm(this.getUserDir(userId), { recursive: true, force: true });
  }

  /** Remove a worker's workspace (volume or directory). In directory mode the
   * path is scoped by userId; in volume mode the volume is keyed by the globally
   * unique containerName. */
  async removeWorkerWorkspace(userId: string, name: string, containerName: string): Promise<void> {
    if (this.mode === 'directory') {
      await rm(join(this.dataDir, 'users', userId, 'workspaces', name), { recursive: true, force: true });
    } else {
      await this.removeVolume(`${containerName}-workspace`);
    }
  }

  /** Remove a worker's Docker-in-Docker volume (always a named volume). */
  async removeWorkerDocker(containerName: string): Promise<void> {
    await this.removeVolume(`${containerName}-docker`);
  }

  /** Remove a worker's persistent agent config data (volume or directory). */
  async removeWorkerAgents(userId: string, name: string, containerName: string): Promise<void> {
    if (this.mode === 'directory') {
      await rm(join(this.dataDir, 'users', userId, 'agents', name), { recursive: true, force: true });
    } else {
      await this.removeVolume(`${containerName}-agents`);
    }
  }

  /** Ensure Traefik cert directory exists (directory mode only) */
  async ensureCertDir(): Promise<void> {
    if (this.mode !== 'directory') return;
    await mkdir(join(this.dataDir, 'traefik-certs'), { recursive: true });
  }

  /** Ensure self-signed cert directory exists (directory mode only) */
  async ensureSelfSignedCertDir(): Promise<void> {
    if (this.mode !== 'directory') return;
    await mkdir(join(this.dataDir, 'selfsigned-certs'), { recursive: true });
  }

  /** In-container path of the built-in defaults directory
   * (`/data/defaults/`) — holds seeded capabilities, instructions, init scripts,
   * and environments that ship with the platform. */
  getDefaultsDir(): string {
    return join(this.dataDir, 'defaults');
  }

  /** Ensure the `defaults/` directory exists. Called at startup before built-in
   * seeding so the seed writers can simply write. */
  async ensureDefaultsDir(): Promise<void> {
    await mkdir(this.getDefaultsDir(), { recursive: true });
  }

  private async removeVolume(volumeName: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.remove();
    } catch {
      // Volume may not exist — ignore
    }
  }

  private async chownDir(dir: string): Promise<void> {
    try {
      await chown(dir, AGENT_UID, AGENT_GID);
    } catch {
      // Best effort — mainly relevant in directory mode where the host
      // filesystem persists, and even there the entrypoint re-chowns.
    }
  }
}
