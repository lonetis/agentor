import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import Docker from 'dockerode';
import type { Config } from './config';
import type { DomainMappingStore, DomainMapping } from './domain-mapping-store';

const TRAEFIK_CONTAINER_NAME = 'agentor-traefik';
const TRAEFIK_LABEL = 'agentor.managed';
const TRAEFIK_LABEL_VALUE = 'traefik';

export class TraefikManager {
  private docker: Docker;
  private config: Config;
  private store: DomainMappingStore;
  private reconcileQueue: Promise<void> = Promise.resolve();

  constructor(config: Config, store: DomainMappingStore) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = config;
    this.store = store;
  }

  async init(): Promise<void> {
    if (!this.config.baseDomain) return;
    await this.reconcile();
  }

  reconcile(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.then(() => this.reconcileNow()).catch((err) => {
      console.error('[traefik-manager] reconcile failed:', err instanceof Error ? err.message : err);
    });
    return this.reconcileQueue;
  }

  private async reconcileNow(): Promise<void> {
    if (!this.config.baseDomain) return;

    const mappings = this.store.list();
    const hasDashboard = !!this.config.dashboardSubdomain;

    if (mappings.length === 0 && !hasDashboard) {
      await this.removeTraefik();
      return;
    }

    await this.writeTraefikConfig(mappings);

    const container = await this.findTraefik();
    if (container) {
      const info = await this.docker.getContainer(container.Id).inspect();
      if (!info.State.Running) {
        await this.docker.getContainer(container.Id).start();
      }
      return;
    }

    await this.createTraefik();
  }

  private async writeTraefikConfig(mappings: DomainMapping[]): Promise<void> {
    const baseDomain = this.config.baseDomain;
    const config = {
      http: { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown>, middlewares: {} as Record<string, unknown> },
      tcp: { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown> },
    };

    if (this.config.dashboardSubdomain) {
      const dashHost = `${this.config.dashboardSubdomain}.${baseDomain}`;
      const dashMiddlewares: string[] = [];

      if (this.config.dashboardAuthUser && this.config.dashboardAuthPassword) {
        const htpasswd = generateHtpasswd(this.config.dashboardAuthUser, this.config.dashboardAuthPassword);
        config.http.middlewares['auth-dashboard'] = {
          basicAuth: { users: [htpasswd] },
        };
        dashMiddlewares.push('auth-dashboard');
      }

      config.http.routers['dashboard'] = {
        rule: `Host(\`${dashHost}\`)`,
        service: 'dashboard',
        entryPoints: ['websecure'],
        tls: { certResolver: 'letsencrypt' },
        ...(dashMiddlewares.length > 0 ? { middlewares: dashMiddlewares } : {}),
      };
      config.http.services['dashboard'] = {
        loadBalancer: { servers: [{ url: 'http://agentor-orchestrator:3000' }] },
      };
    }

    for (const m of mappings) {
      const host = `${m.subdomain}.${baseDomain}`;
      const safeId = m.id.replace(/[^a-zA-Z0-9-]/g, '');

      if (m.protocol === 'tcp') {
        config.tcp.routers[`tcp-${safeId}`] = {
          rule: `HostSNI(\`${host}\`)`,
          service: `tcp-${safeId}`,
          entryPoints: ['websecure'],
          tls: { certResolver: 'letsencrypt' },
        };
        config.tcp.services[`tcp-${safeId}`] = {
          loadBalancer: { servers: [{ address: `${m.workerName}:${m.internalPort}` }] },
        };
      } else {
        const middlewares: string[] = [];

        if (m.basicAuth?.username && m.basicAuth?.password) {
          const htpasswd = generateHtpasswd(m.basicAuth.username, m.basicAuth.password);
          config.http.middlewares[`auth-${safeId}`] = {
            basicAuth: { users: [htpasswd] },
          };
          middlewares.push(`auth-${safeId}`);
        }

        config.http.routers[`http-${safeId}`] = {
          rule: `Host(\`${host}\`)`,
          service: `http-${safeId}`,
          entryPoints: ['websecure'],
          tls: { certResolver: 'letsencrypt' },
          ...(middlewares.length > 0 ? { middlewares } : {}),
        };
        config.http.services[`http-${safeId}`] = {
          loadBalancer: { servers: [{ url: `http://${m.workerName}:${m.internalPort}` }] },
        };
      }
    }

    const configPath = join(this.config.dataDir, 'traefik-config.json');
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }

  private async createTraefik(): Promise<void> {
    if (!this.config.acmeEmail) {
      console.warn('[traefik-manager] ACME_EMAIL not configured — TLS certificates will not be issued');
    }

    const image = this.config.workerImagePrefix + this.config.traefikImage;

    const cmd = [
      '--entrypoints.web.address=:80',
      '--entrypoints.websecure.address=:443',
      '--entrypoints.web.http.redirections.entrypoint.to=websecure',
      '--entrypoints.web.http.redirections.entrypoint.scheme=https',
      '--providers.file.filename=/data/traefik-config.json',
      '--providers.file.watch=true',
      '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web',
      `--certificatesresolvers.letsencrypt.acme.email=${this.config.acmeEmail}`,
      '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
    ];

    const container = await this.docker.createContainer({
      Image: image,
      name: TRAEFIK_CONTAINER_NAME,
      Cmd: cmd,
      ExposedPorts: { '80/tcp': {}, '443/tcp': {} },
      Labels: {
        [TRAEFIK_LABEL]: TRAEFIK_LABEL_VALUE,
      },
      HostConfig: {
        NetworkMode: this.config.dockerNetwork,
        PortBindings: {
          '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '80' }],
          '443/tcp': [{ HostIp: '0.0.0.0', HostPort: '443' }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: [
          `${this.config.dataVolume}:/data:ro`,
          'agentor-traefik-certs:/letsencrypt',
        ],
      },
    });

    await container.start();
    console.log('[traefik-manager] created Traefik container');
  }

  private async removeTraefik(): Promise<void> {
    const container = await this.findTraefik();
    if (!container) return;

    try {
      const c = this.docker.getContainer(container.Id);
      await c.remove({ force: true });
      console.log('[traefik-manager] removed Traefik container');
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 404) throw err;
    }
  }

  private async findTraefik(): Promise<Docker.ContainerInfo | null> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${TRAEFIK_LABEL}=${TRAEFIK_LABEL_VALUE}`] },
    });
    return containers[0] || null;
  }
}

function generateHtpasswd(username: string, password: string): string {
  const hash = createHash('sha1').update(password).digest('base64');
  return `${username}:{SHA}${hash}`;
}
