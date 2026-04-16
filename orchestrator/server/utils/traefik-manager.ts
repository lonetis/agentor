import { createHash } from 'node:crypto';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import Docker from 'dockerode';
import type { Config, BaseDomainConfig } from './config';
import type { DomainMappingStore, DomainMapping } from './domain-mapping-store';
import type { StorageManager } from './storage';
import type { SelfSignedCertManager } from './selfsigned-certs';

const TRAEFIK_CONTAINER_NAME = 'agentor-traefik';
const TRAEFIK_LABEL = 'agentor.managed';
const TRAEFIK_LABEL_VALUE = 'traefik';

export class TraefikManager {
  private docker: Docker;
  private config: Config;
  private store: DomainMappingStore;
  private storageManager: StorageManager;
  private selfSignedCertManager: SelfSignedCertManager;
  private reconcileQueue: Promise<void> = Promise.resolve();
  private configFileJustCreated = false;

  constructor(config: Config, store: DomainMappingStore, storageManager: StorageManager, selfSignedCertManager: SelfSignedCertManager) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = config;
    this.store = store;
    this.storageManager = storageManager;
    this.selfSignedCertManager = selfSignedCertManager;
  }

  async init(): Promise<void> {
    if (this.config.baseDomains.length === 0) return;

    const selfSignedDomains = this.config.baseDomainConfigs
      .filter((c) => c.challengeType === 'selfsigned')
      .map((c) => c.domain);
    if (selfSignedDomains.length > 0) {
      await this.selfSignedCertManager.init(selfSignedDomains);
    }

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
      useLogger().info('[traefik-manager] created empty config file');
    }
  }

  reconcile(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.then(() => this.reconcileNow()).catch((err) => {
      useLogger().error(`[traefik-manager] reconcile failed: ${err instanceof Error ? err.message : err}`);
    });
    return this.reconcileQueue;
  }

  forceRecreate(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.then(() => this.forceRecreateNow()).catch((err) => {
      useLogger().error(`[traefik-manager] force recreate failed: ${err instanceof Error ? err.message : err}`);
    });
    return this.reconcileQueue;
  }

  private async forceRecreateNow(): Promise<void> {
    if (this.config.baseDomains.length === 0) return;

    const mappings = this.store.list();
    const hasDashboard = !!this.config.dashboardSubdomain;
    if (mappings.length === 0 && !hasDashboard) return;

    await this.removeTraefik();
    await this.writeTraefikConfig(mappings);
    await this.createTraefik();
  }

  private async reconcileNow(): Promise<void> {
    if (this.config.baseDomains.length === 0) return;

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
        this.configFileJustCreated = false;
        await c.restart();
        useLogger().info('[traefik-manager] restarted Traefik (config file was recreated)');
      } else if (this.hasContainerConfigDrift(info)) {
        useLogger().info('[traefik-manager] config drift detected — recreating Traefik container');
        await this.removeTraefik();
        await this.createTraefik();
      }
      return;
    }

    await this.createTraefik();
  }

  private getDomainConfig(baseDomain: string): BaseDomainConfig | undefined {
    return this.config.baseDomainConfigs.find((c) => c.domain === baseDomain);
  }

  private getTlsConfig(baseDomain: string): Record<string, unknown> | undefined {
    const dc = this.getDomainConfig(baseDomain);
    if (!dc || dc.challengeType === 'none') return undefined;
    if (dc.challengeType === 'selfsigned') return {};
    if (dc.challengeType === 'http') return { certResolver: 'letsencrypt' };
    return {
      certResolver: `letsencrypt-dns-${dc.dnsProvider}`,
      domains: [{ main: dc.domain, sans: [`*.${dc.domain}`] }],
    };
  }

  /**
   * TLS config for a wildcard mapping — requests a cert that covers both the
   * exact host and `*.host`, so deeper subdomain routing works under TLS.
   * Used for DNS challenge base domains; selfsigned reuses the file provider
   * with per-host wildcard certs (returned as empty object).
   */
  private getWildcardTlsConfig(host: string, baseDomain: string): Record<string, unknown> | undefined {
    const dc = this.getDomainConfig(baseDomain);
    if (!dc || dc.challengeType === 'none') return undefined;
    if (dc.challengeType === 'selfsigned') return {};
    if (dc.challengeType === 'http') return undefined; // never happens — API rejects
    return {
      certResolver: `letsencrypt-dns-${dc.dnsProvider}`,
      domains: [{ main: host, sans: [`*.${host}`] }],
    };
  }

  /**
   * Go regex that matches any single-label prefix of `host`. Example:
   * host `sub.domain.com` → `^[^.]+\.sub\.domain\.com$`. Matches
   * `foo.sub.domain.com` but not `sub.domain.com` (the exact Host() alternate
   * covers that) and not `foo.bar.sub.domain.com` (too deep — the wildcard
   * certificate would not cover it anyway, so routing it would be misleading).
   */
  private hostRegexFor(host: string): string {
    return `^[^.]+\\.${host.replace(/\./g, '\\.')}$`;
  }

  private async writeTraefikConfig(mappings: DomainMapping[]): Promise<void> {
    const config = {
      http: { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown>, middlewares: {} as Record<string, unknown> },
      tcp: { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown> },
    };

    if (this.config.dashboardSubdomain && this.config.dashboardBaseDomain) {
      const dashHost = `${this.config.dashboardSubdomain}.${this.config.dashboardBaseDomain}`;
      const dashMiddlewares: string[] = [];

      if (this.config.dashboardAuthUser && this.config.dashboardAuthPassword) {
        const htpasswd = generateHtpasswd(this.config.dashboardAuthUser, this.config.dashboardAuthPassword);
        config.http.middlewares['auth-dashboard'] = {
          basicAuth: { users: [htpasswd] },
        };
        dashMiddlewares.push('auth-dashboard');
      }

      const dashTls = this.getTlsConfig(this.config.dashboardBaseDomain);
      config.http.routers['dashboard'] = {
        rule: `Host(\`${dashHost}\`)`,
        service: 'dashboard',
        entryPoints: [dashTls ? 'websecure' : 'web'],
        ...(dashTls ? { tls: dashTls } : {}),
        ...(dashMiddlewares.length > 0 ? { middlewares: dashMiddlewares } : {}),
      };
      config.http.services['dashboard'] = {
        loadBalancer: { servers: [{ url: 'http://agentor-orchestrator:3000' }] },
      };
    }

    // Wildcard self-signed mappings need a per-host wildcard cert generated
    // before Traefik reads the file provider config. Collect the unique hosts
    // up front and make sure each has a cert on disk.
    const selfSignedWildcardHosts = new Set<string>();
    for (const m of mappings) {
      if (!m.wildcard) continue;
      const dc = this.getDomainConfig(m.baseDomain);
      if (dc?.challengeType !== 'selfsigned') continue;
      const host = m.subdomain ? `${m.subdomain}.${m.baseDomain}` : m.baseDomain;
      // Base-domain certs are already generated by init() — skip those.
      if (host === m.baseDomain) continue;
      selfSignedWildcardHosts.add(host);
    }
    for (const host of selfSignedWildcardHosts) {
      await this.selfSignedCertManager.ensureWildcardCertForHost(host);
    }

    for (const m of mappings) {
      const host = m.subdomain ? `${m.subdomain}.${m.baseDomain}` : m.baseDomain;
      const safeId = m.id.replace(/[^a-zA-Z0-9-]/g, '');

      if (m.protocol === 'tcp') {
        // TCP + wildcard requires TLS (HostSNI). The API rejects wildcard on
        // `http` ACME, so any TLS we see here is DNS or selfsigned — both can
        // issue wildcard certs.
        const tls = m.wildcard
          ? this.getWildcardTlsConfig(host, m.baseDomain)
          : this.getTlsConfig(m.baseDomain);
        const tcpRule = m.wildcard
          ? `HostSNI(\`${host}\`) || HostSNIRegexp(\`${this.hostRegexFor(host)}\`)`
          : `HostSNI(\`${host}\`)`;
        config.tcp.routers[`tcp-${safeId}`] = {
          rule: tcpRule,
          service: `tcp-${safeId}`,
          entryPoints: ['websecure'],
          ...(tls ? { tls } : {}),
          // Lower priority for wildcard routes so an exact-host mapping always
          // wins when both could match the same SNI name.
          ...(m.wildcard ? { priority: 1 } : {}),
        };
        config.tcp.services[`tcp-${safeId}`] = {
          loadBalancer: { servers: [{ address: `${m.workerName}:${m.internalPort}` }] },
        };
      } else {
        const middlewares: string[] = [];

        if (m.path) {
          config.http.middlewares[`strip-${safeId}`] = {
            stripPrefix: { prefixes: [m.path] },
          };
          middlewares.push(`strip-${safeId}`);
        }

        if (m.basicAuth?.username && m.basicAuth?.password) {
          const htpasswd = generateHtpasswd(m.basicAuth.username, m.basicAuth.password);
          config.http.middlewares[`auth-${safeId}`] = {
            basicAuth: { users: [htpasswd] },
          };
          middlewares.push(`auth-${safeId}`);
        }

        const hostClause = m.wildcard
          ? `(Host(\`${host}\`) || HostRegexp(\`${this.hostRegexFor(host)}\`))`
          : `Host(\`${host}\`)`;
        const rule = m.path
          ? `${hostClause} && PathPrefix(\`${m.path}\`)`
          : hostClause;
        const isHttpOnly = m.protocol === 'http';
        const tls = isHttpOnly
          ? undefined
          : (m.wildcard
              ? this.getWildcardTlsConfig(host, m.baseDomain)
              : this.getTlsConfig(m.baseDomain));
        config.http.routers[`http-${safeId}`] = {
          rule,
          service: `http-${safeId}`,
          entryPoints: [tls ? 'websecure' : 'web'],
          ...(tls ? { tls } : {}),
          ...(middlewares.length > 0 ? { middlewares } : {}),
          ...(m.wildcard ? { priority: 1 } : {}),
        };
        config.http.services[`http-${safeId}`] = {
          loadBalancer: { servers: [{ url: `http://${m.workerName}:${m.internalPort}` }] },
        };
      }
    }

    // Add self-signed TLS certificates to the file provider config — both the
    // per-base-domain wildcards generated at init() time and the per-host
    // wildcards generated above for wildcard subdomain mappings.
    const selfSignedBaseDomains = this.config.baseDomainConfigs.filter((c) => c.challengeType === 'selfsigned');
    if (selfSignedBaseDomains.length > 0 || selfSignedWildcardHosts.size > 0) {
      const certs: { certFile: string; keyFile: string }[] = selfSignedBaseDomains.map((dc) => ({
        certFile: this.selfSignedCertManager.getTraefikCertPath(dc.domain),
        keyFile: this.selfSignedCertManager.getTraefikKeyPath(dc.domain),
      }));
      for (const host of selfSignedWildcardHosts) {
        certs.push({
          certFile: this.selfSignedCertManager.getTraefikCertPath(host),
          keyFile: this.selfSignedCertManager.getTraefikKeyPath(host),
        });
      }
      (config as Record<string, unknown>).tls = { certificates: certs };
    }

    // Strip empty sub-objects — Traefik v3 rejects standalone empty maps
    const clean: Record<string, unknown> = {};
    for (const [proto, sections] of Object.entries(config)) {
      if (proto === 'tls') {
        clean[proto] = sections;
        continue;
      }
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

  buildCmd(): string[] {
    const cmd = [
      '--entrypoints.web.address=:80',
      '--entrypoints.websecure.address=:443',
      '--providers.file.filename=/data/traefik-config.json',
      '--providers.file.watch=true',
      '--ping=true',
    ];

    const hasHttp = this.config.baseDomainConfigs.some((c) => c.challengeType === 'http');
    if (hasHttp) {
      cmd.push(
        '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web',
        `--certificatesresolvers.letsencrypt.acme.email=${this.config.acmeEmail}`,
        '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
      );
    }

    for (const [name, pc] of Object.entries(this.config.dnsProviderConfigs)) {
      const prefix = `--certificatesresolvers.letsencrypt-dns-${name}.acme`;
      cmd.push(
        `${prefix}.dnschallenge.provider=${name}`,
        `${prefix}.email=${this.config.acmeEmail}`,
        `${prefix}.storage=/letsencrypt/acme.json`,
      );
      if (pc.delay) {
        cmd.push(`${prefix}.dnschallenge.delaybeforecheck=${pc.delay}`);
      }
      if (pc.resolvers.length > 0) {
        cmd.push(`${prefix}.dnschallenge.resolvers=${pc.resolvers.join(',')}`);
      }
    }

    return cmd;
  }

  buildEnv(): string[] {
    const env: string[] = [];
    for (const pc of Object.values(this.config.dnsProviderConfigs)) {
      for (const varName of pc.envVarNames) {
        const val = process.env[varName] || '';
        env.push(`${varName}=${val}`);
      }
    }
    return env;
  }

  private hasContainerConfigDrift(info: Docker.ContainerInspectInfo): boolean {
    const expectedCmd = this.buildCmd();
    const actualCmd = info.Config?.Cmd || [];
    if (JSON.stringify(expectedCmd) !== JSON.stringify(actualCmd)) return true;

    const expectedEnv = this.buildEnv();
    if (expectedEnv.length === 0) return false;

    const actualEnvSet = new Set(info.Config?.Env || []);
    for (const e of expectedEnv) {
      if (!actualEnvSet.has(e)) return true;
    }
    return false;
  }

  private async createTraefik(): Promise<void> {
    const hasAcmeCerts = this.config.baseDomainConfigs.some((c) => c.challengeType === 'http' || c.challengeType === 'dns');
    if (hasAcmeCerts && !this.config.acmeEmail) {
      useLogger().warn('[traefik-manager] ACME_EMAIL not configured — TLS certificates will not be issued');
    }

    await this.storageManager.ensureCertDir();

    const image = this.config.traefikImage;

    await this.ensureImage(image);

    const cmd = this.buildCmd();
    const env = this.buildEnv();

    const container = await this.docker.createContainer({
      Image: image,
      name: TRAEFIK_CONTAINER_NAME,
      Cmd: cmd,
      ...(env.length > 0 ? { Env: env } : {}),
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
          this.storageManager.getDataBind(true),
          this.storageManager.getCertBind(),
        ],
      },
    });

    await container.start();
    useLogger().info('[traefik-manager] created Traefik container');
    useLogCollector().attach(TRAEFIK_CONTAINER_NAME, container.id, 'traefik').catch(() => {});
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      useLogger().info(`[traefik-manager] pulling image ${image}...`);
      const stream = await this.docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
      });
      useLogger().info(`[traefik-manager] pulled image ${image}`);
    }
  }

  private async removeTraefik(): Promise<void> {
    const container = await this.findTraefik();
    if (!container) return;

    try {
      useLogCollector().detach(container.Id);
      const c = this.docker.getContainer(container.Id);
      await c.remove({ force: true });
      useLogger().info('[traefik-manager] removed Traefik container');
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
