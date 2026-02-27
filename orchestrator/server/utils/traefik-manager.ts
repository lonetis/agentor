import { createHash } from 'node:crypto';
import { writeFile, mkdir, access } from 'node:fs/promises';
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
  private configFileJustCreated = false;

  constructor(config: Config, store: DomainMappingStore) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = config;
    this.store = store;
  }

  async init(): Promise<void> {
    if (!this.config.baseDomain) return;
    await this.ensureConfigFile();
    await this.reconcile();
  }

  private async ensureConfigFile(): Promise<void> {
    const configPath = join(this.config.dataDir, 'traefik-config.json');
    try {
      await access(configPath);
    } catch {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, '{}');
      this.configFileJustCreated = true;
      console.log('[traefik-manager] created empty config file');
    }
  }

  reconcile(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.then(() => this.reconcileNow()).catch((err) => {
      console.error('[traefik-manager] reconcile failed:', err instanceof Error ? err.message : err);
    });
    return this.reconcileQueue;
  }

  forceRecreate(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.then(() => this.forceRecreateNow()).catch((err) => {
      console.error('[traefik-manager] force recreate failed:', err instanceof Error ? err.message : err);
    });
    return this.reconcileQueue;
  }

  private async forceRecreateNow(): Promise<void> {
    if (!this.config.baseDomain) return;

    const mappings = this.store.list();
    const hasDashboard = !!this.config.dashboardSubdomain;
    if (mappings.length === 0 && !hasDashboard) return;

    await this.removeTraefik();
    await this.writeTraefikConfig(mappings);
    await this.createTraefik();
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
      const c = this.docker.getContainer(container.Id);
      const info = await c.inspect();
      if (!info.State.Running) {
        await c.start();
      } else if (this.configFileJustCreated) {
        // Config file was just created — Traefik likely started before it existed,
        // causing the file provider to fail fatally. Restart to reinitialize.
        this.configFileJustCreated = false;
        await c.restart();
        console.log('[traefik-manager] restarted Traefik (config file was recreated)');
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

        const isHttpOnly = m.protocol === 'http';
        config.http.routers[`http-${safeId}`] = {
          rule: `Host(\`${host}\`)`,
          service: `http-${safeId}`,
          entryPoints: [isHttpOnly ? 'web' : 'websecure'],
          ...(isHttpOnly ? {} : { tls: { certResolver: 'letsencrypt' } }),
          ...(middlewares.length > 0 ? { middlewares } : {}),
        };
        config.http.services[`http-${safeId}`] = {
          loadBalancer: { servers: [{ url: `http://${m.workerName}:${m.internalPort}` }] },
        };
      }
    }

    // Strip empty sub-objects — Traefik v3 rejects standalone empty maps
    const clean: Record<string, unknown> = {};
    for (const [proto, sections] of Object.entries(config)) {
      const filtered: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(sections as Record<string, Record<string, unknown>>)) {
        if (Object.keys(val).length > 0) filtered[key] = val;
      }
      if (Object.keys(filtered).length > 0) clean[proto] = filtered;
    }

    const configPath = join(this.config.dataDir, 'traefik-config.json');
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(clean, null, 2));
  }

  private async createTraefik(): Promise<void> {
    if (!this.config.acmeEmail) {
      console.warn('[traefik-manager] ACME_EMAIL not configured — TLS certificates will not be issued');
    }

    const image = this.config.traefikImage;

    await this.ensureImage(image);

    const cmd = [
      '--entrypoints.web.address=:80',
      '--entrypoints.websecure.address=:443',
      '--providers.file.filename=/data/traefik-config.json',
      '--providers.file.watch=true',
      '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web',
      `--certificatesresolvers.letsencrypt.acme.email=${this.config.acmeEmail}`,
      '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
      '--ping=true',
    ];

    const container = await this.docker.createContainer({
      Image: image,
      name: TRAEFIK_CONTAINER_NAME,
      Cmd: cmd,
      ExposedPorts: { '80/tcp': {}, '443/tcp': {} },
      Labels: {
        [TRAEFIK_LABEL]: TRAEFIK_LABEL_VALUE,
      },
      Healthcheck: {
        Test: ['CMD-SHELL', 'wget -qO- http://localhost:8080/ping || exit 1'],
        Interval: 30_000_000_000,
        Timeout: 5_000_000_000,
        Retries: 3,
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

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      console.log(`[traefik-manager] pulling image ${image}...`);
      const stream = await this.docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
      });
      console.log(`[traefik-manager] pulled image ${image}`);
    }
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
