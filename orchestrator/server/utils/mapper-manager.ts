import Docker from 'dockerode';
import type { Config } from './config';
import type { PortMappingStore, PortMapping } from './port-mapping-store';

const MAPPER_CONTAINER_NAME = 'agentor-mapper';
const MAPPER_LABEL = 'agentor.managed';
const MAPPER_LABEL_VALUE = 'mapper';

export class MapperManager {
  private docker: Docker;
  private config: Config;
  private store: PortMappingStore;
  private reconcileQueue: Promise<void> = Promise.resolve();

  constructor(config: Config, store: PortMappingStore) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = config;
    this.store = store;
  }

  async init(): Promise<void> {
    await this.reconcile();
  }

  reconcile(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.then(() => this.reconcileNow()).catch((err) => {
      console.error('[mapper-manager] reconcile failed:', err instanceof Error ? err.message : err);
    });
    return this.reconcileQueue;
  }

  forceRecreate(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.then(() => this.forceRecreateNow()).catch((err) => {
      console.error('[mapper-manager] force recreate failed:', err instanceof Error ? err.message : err);
    });
    return this.reconcileQueue;
  }

  private async reconcileNow(): Promise<void> {
    const mappings = this.store.list();

    if (mappings.length === 0) {
      await this.removeMapper();
      return;
    }

    const desired = this.buildPortBindings(mappings);
    const current = await this.getCurrentBindings();

    if (this.bindingsMatch(desired, current)) {
      // Ensure container is running
      const container = await this.findMapper();
      if (container) {
        const info = await this.docker.getContainer(container.Id).inspect();
        if (!info.State.Running) {
          await this.docker.getContainer(container.Id).start();
        }
      } else {
        await this.createMapper(mappings, desired);
      }
      return;
    }

    await this.removeMapper();
    await this.createMapper(mappings, desired);
  }

  private async createMapper(
    mappings: PortMapping[],
    portBindings: Record<string, { HostIp: string; HostPort: string }[]>
  ): Promise<void> {
    const image = this.config.workerImagePrefix + this.config.mapperImage;
    await this.ensureImage(image);

    const exposedPorts: Record<string, object> = {};
    for (const key of Object.keys(portBindings)) {
      exposedPorts[key] = {};
    }

    const container = await this.docker.createContainer({
      Image: image,
      name: MAPPER_CONTAINER_NAME,
      ExposedPorts: exposedPorts,
      Labels: {
        [MAPPER_LABEL]: MAPPER_LABEL_VALUE,
      },
      HostConfig: {
        NetworkMode: this.config.dockerNetwork,
        PortBindings: portBindings,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: [`${this.config.dataVolume}:/data:ro`],
      },
    });

    await container.start();
    console.log(`[mapper-manager] created mapper with ${mappings.length} mapping(s)`);
  }

  private async forceRecreateNow(): Promise<void> {
    const mappings = this.store.list();
    if (mappings.length === 0) return;

    const desired = this.buildPortBindings(mappings);
    await this.removeMapper();
    await this.createMapper(mappings, desired);
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      console.log(`[mapper-manager] pulling image ${image}...`);
      const stream = await this.docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
      });
      console.log(`[mapper-manager] pulled image ${image}`);
    }
  }

  private async removeMapper(): Promise<void> {
    const container = await this.findMapper();
    if (!container) return;

    try {
      const c = this.docker.getContainer(container.Id);
      await c.remove({ force: true });
      console.log('[mapper-manager] removed mapper container');
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 404) throw err;
    }
  }

  private async findMapper(): Promise<Docker.ContainerInfo | null> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${MAPPER_LABEL}=${MAPPER_LABEL_VALUE}`] },
    });
    return containers[0] || null;
  }

  private async getCurrentBindings(): Promise<Record<string, { HostIp: string; HostPort: string }[]> | null> {
    const container = await this.findMapper();
    if (!container) return null;

    const info = await this.docker.getContainer(container.Id).inspect();
    const bindings = info.HostConfig?.PortBindings;
    if (!bindings || Object.keys(bindings).length === 0) return null;

    const result: Record<string, { HostIp: string; HostPort: string }[]> = {};
    for (const [key, val] of Object.entries(bindings)) {
      if (Array.isArray(val) && val.length > 0) {
        result[key] = val.map((v: { HostIp?: string; HostPort?: string }) => ({
          HostIp: v.HostIp || '',
          HostPort: v.HostPort || '',
        }));
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  private buildPortBindings(
    mappings: PortMapping[]
  ): Record<string, { HostIp: string; HostPort: string }[]> {
    const bindings: Record<string, { HostIp: string; HostPort: string }[]> = {};
    for (const m of mappings) {
      const hostIp = m.type === 'localhost' ? '127.0.0.1' : '0.0.0.0';
      bindings[`${m.externalPort}/tcp`] = [
        { HostIp: hostIp, HostPort: String(m.externalPort) },
      ];
    }
    return bindings;
  }

  private bindingsMatch(
    desired: Record<string, { HostIp: string; HostPort: string }[]>,
    current: Record<string, { HostIp: string; HostPort: string }[]> | null
  ): boolean {
    if (!current) return false;

    const desiredKeys = Object.keys(desired).sort();
    const currentKeys = Object.keys(current).sort();

    if (desiredKeys.length !== currentKeys.length) return false;

    for (let i = 0; i < desiredKeys.length; i++) {
      if (desiredKeys[i] !== currentKeys[i]) return false;
      const dVal = desired[desiredKeys[i]!]!;
      const cVal = current[currentKeys[i]!]!;
      if (dVal.length !== cVal.length) return false;
      for (let j = 0; j < dVal.length; j++) {
        if (dVal[j]!.HostIp !== cVal[j]!.HostIp || dVal[j]!.HostPort !== cVal[j]!.HostPort) {
          return false;
        }
      }
    }

    return true;
  }
}
