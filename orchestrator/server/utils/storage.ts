import Docker from 'dockerode';
import { mkdir, rm, chown } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config';

type StorageMode = 'volume' | 'directory';

const AGENT_UID = 1000;
const AGENT_GID = 1000;

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

  /** Bind string for mounting the data directory (used by mapper and traefik) */
  getDataBind(readOnly = false): string {
    const suffix = readOnly ? ':ro' : '';
    return `${this.dataRef}:/data${suffix}`;
  }

  /** Bind string for a worker's workspace */
  getWorkerWorkspaceBind(name: string): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'workspaces', name)}:/workspace`;
    }
    return `${name}-workspace:/workspace`;
  }

  /** Bind string for a worker's Docker-in-Docker data (always a named volume — overlay2 requires a native filesystem) */
  getWorkerDockerBind(name: string): string {
    return `${name}-docker:/var/lib/docker`;
  }

  /** Bind string for a worker's persistent agent config data (~/.claude, ~/.gemini, ~/.codex, ~/.agents) */
  getWorkerAgentsBind(name: string): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'agents', name)}:/home/agent/.agent-data`;
    }
    return `${name}-agents:/home/agent/.agent-data`;
  }

  /** Bind string for Traefik certificate storage */
  getCertBind(): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'traefik-certs')}:/letsencrypt`;
    }
    return 'agentor-traefik-certs:/letsencrypt';
  }

  /** Ensure workspace and agents directories exist with correct ownership (directory mode only) */
  async ensureWorkerDirs(name: string): Promise<void> {
    if (this.mode !== 'directory') return;

    const workspaceDir = join(this.dataDir, 'workspaces', name);
    await mkdir(workspaceDir, { recursive: true });
    await this.chownDir(workspaceDir);

    const agentsDir = join(this.dataDir, 'agents', name);
    await mkdir(agentsDir, { recursive: true });
    await this.chownDir(agentsDir);
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

  /** Remove a user's entire data directory (credentials + anything else). */
  async removeUserDir(userId: string): Promise<void> {
    await rm(this.getUserDir(userId), { recursive: true, force: true });
  }

  /** Remove a worker's workspace (volume or directory) */
  async removeWorkerWorkspace(name: string): Promise<void> {
    if (this.mode === 'directory') {
      await rm(join(this.dataDir, 'workspaces', name), { recursive: true, force: true });
    } else {
      await this.removeVolume(`${name}-workspace`);
    }
  }

  /** Remove a worker's Docker-in-Docker volume (always a named volume) */
  async removeWorkerDocker(name: string): Promise<void> {
    await this.removeVolume(`${name}-docker`);
  }

  /** Remove a worker's persistent agent config data (volume or directory) */
  async removeWorkerAgents(name: string): Promise<void> {
    if (this.mode === 'directory') {
      await rm(join(this.dataDir, 'agents', name), { recursive: true, force: true });
    } else {
      await this.removeVolume(`${name}-agents`);
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

  private async removeVolume(volumeName: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.remove();
    } catch {
      // Volume may not exist — ignore
    }
  }

  private async chownDir(dir: string): Promise<void> {
    await chown(dir, AGENT_UID, AGENT_GID);
  }
}
