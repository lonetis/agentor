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
  /** Volume name (volume mode) or host path (directory mode) — used in bind strings */
  dataRef = '';
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
      console.log('[storage] HOSTNAME not set — falling back to volume mode');
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
        console.log('[storage] /data not mounted — falling back to volume mode');
        this.mode = 'volume';
        this.dataRef = this.config.dataVolume;
        return;
      }

      if (dataMount.Type === 'bind') {
        this.mode = 'directory';
        this.dataRef = dataMount.Source;
        console.log(`[storage] directory mode — host path: ${this.dataRef}`);
      } else {
        this.mode = 'volume';
        this.dataRef = dataMount.Name || this.config.dataVolume;
        console.log(`[storage] volume mode — volume: ${this.dataRef}`);
      }
    } catch (err: unknown) {
      console.error('[storage] init failed, falling back to volume mode:', err instanceof Error ? err.message : err);
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

  /** Bind string for a worker's Docker-in-Docker data */
  getWorkerDockerBind(name: string): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'docker', name)}:/var/lib/docker`;
    }
    return `${name}-docker:/var/lib/docker`;
  }

  /** Bind string for Traefik certificate storage */
  getCertBind(): string {
    if (this.mode === 'directory') {
      return `${join(this.dataRef, 'traefik-certs')}:/letsencrypt`;
    }
    return 'agentor-traefik-certs:/letsencrypt';
  }

  /** Ensure workspace (and optionally docker) directories exist with correct ownership */
  async ensureWorkerDirs(name: string, dockerEnabled: boolean): Promise<void> {
    if (this.mode !== 'directory') return;

    const workspaceDir = join(this.dataDir, 'workspaces', name);
    await mkdir(workspaceDir, { recursive: true });
    await this.chownDir(workspaceDir);

    if (dockerEnabled) {
      const dockerDir = join(this.dataDir, 'docker', name);
      await mkdir(dockerDir, { recursive: true });
    }
  }

  /** Remove a worker's workspace (volume or directory) */
  async removeWorkerWorkspace(name: string): Promise<void> {
    if (this.mode === 'directory') {
      await rm(join(this.dataDir, 'workspaces', name), { recursive: true, force: true });
    } else {
      await this.removeVolume(`${name}-workspace`);
    }
  }

  /** Remove a worker's Docker-in-Docker data (volume or directory) */
  async removeWorkerDocker(name: string): Promise<void> {
    if (this.mode === 'directory') {
      await rm(join(this.dataDir, 'docker', name), { recursive: true, force: true });
    } else {
      await this.removeVolume(`${name}-docker`);
    }
  }

  /** Ensure Traefik cert directory exists (directory mode only) */
  async ensureCertDir(): Promise<void> {
    if (this.mode !== 'directory') return;
    await mkdir(join(this.dataDir, 'traefik-certs'), { recursive: true });
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
