import { createHash } from 'node:crypto';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import Docker from 'dockerode';
import { stringify as stringifyYaml } from 'yaml';
import type { Config, BaseDomainConfig } from './config';
import type { DomainMappingStore, DomainMapping } from './domain-mapping-store';
import type { PortMappingStore, PortMapping } from './port-mapping-store';
import type { StorageManager } from './storage';
import type { SelfSignedCertManager } from './selfsigned-certs';

const TRAEFIK_CONTAINER_NAME = 'agentor-traefik';
const TRAEFIK_LABEL = 'agentor.managed';
const TRAEFIK_LABEL_VALUE = 'traefik';
// Traefik detects the dynamic-config format from the file extension, so the
// `.yml` name and the YAML body written below must stay in sync (and match the
// `--providers.file.filename` flag in buildCmd()).
const TRAEFIK_CONFIG_FILENAME = 'traefik-config.yml';
// Hard deadline for the Traefik image pull. Without it a stalled registry pull
// would never settle the reconcileQueue and wedge every later reconcile.
const TRAEFIK_IMAGE_PULL_TIMEOUT_MS = 5 * 60 * 1000;

type PortBindings = Record<string, { HostIp: string; HostPort: string }[]>;

/** The mapping inputs that fully determine a Traefik container's shape
 * (entrypoints, host port bindings, dynamic config). Passed explicitly through
 * the build/create path so a reconcile can be replayed against a previous
 * snapshot (rollback / self-heal) without mutating the stores. */
interface Mappings {
  domain: DomainMapping[];
  port: PortMapping[];
}

/** Thrown when a requested/persisted external port cannot back a Traefik
 * binding — either it is reserved for Traefik's own 80/443 web entrypoints, or
 * it is already occupied on the host by another container. Mapping-create
 * handlers translate this into HTTP 409 so a misconfiguration is rejected
 * cleanly instead of wedging Traefik. */
export class TraefikPortConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TraefikPortConflictError';
  }
}

/** Thrown when (re)creating the Traefik container failed and the previous
 * working container was restored (or could not be). Surfaced to strict callers
 * so they can roll back the persisted mapping that triggered the failed apply. */
export class TraefikReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TraefikReconcileError';
  }
}

export class TraefikManager {
  private docker: Docker;
  private config: Config;
  private domainStore: DomainMappingStore;
  private portStore: PortMappingStore;
  private storageManager: StorageManager;
  private selfSignedCertManager: SelfSignedCertManager;
  private reconcileQueue: Promise<void> = Promise.resolve();
  private configFileJustCreated = false;
  /** Snapshot of the mappings that last produced a *running* Traefik container.
   * On a failed (re)create the reconcile rolls back to this so the dashboard
   * (served through Traefik) always comes back. Null until the first success. */
  private lastGoodMappings: Mappings | null = null;

  constructor(
    config: Config,
    domainStore: DomainMappingStore,
    portStore: PortMappingStore,
    storageManager: StorageManager,
    selfSignedCertManager: SelfSignedCertManager,
  ) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = config;
    this.domainStore = domainStore;
    this.portStore = portStore;
    this.storageManager = storageManager;
    this.selfSignedCertManager = selfSignedCertManager;
  }

  async init(): Promise<void> {
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
    const configPath = join(this.config.dataDir, TRAEFIK_CONFIG_FILENAME);
    try {
      await access(configPath);
    } catch {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, '{}\n');
      this.configFileJustCreated = true;
      useLogger().info('[traefik-manager] created empty config file');
    }
  }

  /** Serialize `fn` after any in-flight reconcile, but return a promise tied to
   * THIS invocation so the caller can observe its success/failure. The queue
   * itself is kept rejection-free (errors are swallowed for chaining) — only the
   * returned promise carries the outcome. */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    // `then(fn, fn)` runs `fn` regardless of whether the previous task settled
    // fulfilled or rejected, so one failing reconcile never stalls the queue.
    const run = this.reconcileQueue.then(fn, fn);
    this.reconcileQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Fire-and-forget reconcile — never rejects (failures are logged and rolled
   * back internally). Used by lifecycle callers (rebuild/unarchive/import/
   * startup) where a transient Traefik blip must not fail the larger operation. */
  reconcile(): Promise<void> {
    return this.enqueue(() => this.reconcileNow()).catch((err) => {
      useLogger().error(`[traefik-manager] reconcile failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  /** Reconcile that REJECTS if the apply it triggered failed. Used by the
   * mapping-create handlers so a mapping that cannot be applied (occupied host
   * port, reserved 80/443, etc.) is rolled back out of the store and reported as
   * a 409, instead of being silently persisted while Traefik wedges. */
  reconcileStrict(): Promise<void> {
    return this.enqueue(() => this.reconcileNow());
  }

  forceRecreate(): Promise<void> {
    return this.enqueue(() => this.forceRecreateNow()).catch((err) => {
      useLogger().error(`[traefik-manager] force recreate failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  /** Layer 1 — reject a port that structurally cannot be a mapping because
   * Traefik binds it on the host for its own web entrypoints. 80/443 are the
   * `web`/`websecure` entrypoints that domain routing and the dashboard
   * subdomain depend on; a `pm-<port>` entrypoint on the same number would make
   * Traefik fail to boot. Called synchronously by create handlers BEFORE the
   * mapping is persisted, so the common misconfig is refused with zero
   * disruption. Throws {@link TraefikPortConflictError}. */
  assertPortAcceptable(externalPort: number): void {
    if ((externalPort === 80 || externalPort === 443) && this.needsWebEntrypoints(this.currentMappings())) {
      const which = externalPort === 80 ? 'HTTP (web)' : 'HTTPS (websecure)';
      throw new TraefikPortConflictError(
        `Port ${externalPort} is reserved for the Traefik ${which} entrypoint used by domain routing and the dashboard. Choose a different external port.`,
      );
    }
  }

  private currentMappings(): Mappings {
    return { domain: this.domainStore.list(), port: this.portStore.list() };
  }

  private shouldRun(m: Mappings): boolean {
    const hasDashboard = !!this.config.dashboardSubdomain && this.config.baseDomains.length > 0;
    return m.domain.length > 0 || m.port.length > 0 || hasDashboard;
  }

  /**
   * Web entrypoints (80/443) are only created when domain mappings or the
   * dashboard need them. Port-only setups skip these to avoid binding ports
   * that nothing will serve. Kept in one place so buildCmd/buildExposedPorts/
   * buildPortBindings can never drift on the predicate.
   */
  private needsWebEntrypoints(m: Mappings): boolean {
    return m.domain.length > 0
      || (!!this.config.dashboardSubdomain && this.config.baseDomains.length > 0);
  }

  private async forceRecreateNow(): Promise<void> {
    const m = this.currentMappings();
    if (!this.shouldRun(m)) {
      await this.removeTraefik();
      this.lastGoodMappings = null;
      return;
    }
    await this.removeTraefik();
    await this.writeTraefikConfig(m);
    await this.createOrRollback(m);
  }

  private async reconcileNow(): Promise<void> {
    const m = this.currentMappings();

    if (!this.shouldRun(m)) {
      await this.removeTraefik();
      this.lastGoodMappings = null;
      return;
    }

    const container = await this.findTraefik();

    // No Traefik yet — first create. Pre-flight every host port we are about to
    // bind so the very first domain/port mapping can't silently fail to start.
    if (!container) {
      await this.preflightHostPorts(this.hostPortsFor(m));
      await this.writeTraefikConfig(m);
      await this.createOrRollback(m);
      return;
    }

    const c = this.docker.getContainer(container.Id);
    const info = await c.inspect();

    // The container exists but isn't running (crashed, or a previously-persisted
    // mapping couldn't bind its host port). Self-heal so the dashboard returns.
    if (!info.State.Running) {
      await this.writeTraefikConfig(m);
      await this.startOrSelfHeal(c, m);
      return;
    }

    if (this.configFileJustCreated) {
      this.configFileJustCreated = false;
      await this.writeTraefikConfig(m);
      await c.restart();
      useLogger().info('[traefik-manager] restarted Traefik (config file was recreated)');
      this.lastGoodMappings = m;
      return;
    }

    if (this.hasContainerConfigDrift(info, m)) {
      // The dangerous path: a recreate drops the running Traefik (and the
      // dashboard). Pre-flight only the NEW host ports (those the running
      // container doesn't already hold) BEFORE removing it, so a conflict is
      // refused without any disruption. (Layer 2)
      const running = this.runningHostPorts(info);
      const newPorts = this.hostPortsFor(m).filter((p) => !running.has(p));
      await this.preflightHostPorts(newPorts);

      useLogger().info('[traefik-manager] config drift detected — recreating Traefik container');
      await this.writeTraefikConfig(m);
      await this.removeTraefik();
      await this.createOrRollback(m);
      return;
    }

    // No drift — apply via the file provider (hot reload, no restart/recreate).
    await this.writeTraefikConfig(m);
    this.lastGoodMappings = m;
  }

  /** Create Traefik for `m`; on a failed start, roll back to the last-known-good
   * config so the dashboard returns, then re-throw so strict callers can undo
   * the persisted mapping that triggered the failure. (Layer 3) */
  private async createOrRollback(m: Mappings): Promise<void> {
    try {
      await this.createTraefik(m);
      this.lastGoodMappings = m;
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useLogger().error(`[traefik-manager] Traefik create failed: ${msg}`);
      if (this.lastGoodMappings) {
        useLogger().warn('[traefik-manager] rolling back Traefik to last-good config');
        await this.removeTraefik().catch(() => {});
        await this.writeTraefikConfig(this.lastGoodMappings);
        try {
          await this.createTraefik(this.lastGoodMappings);
          useLogger().info('[traefik-manager] rollback succeeded — Traefik restored');
        } catch (rbErr) {
          useLogger().error(`[traefik-manager] rollback ALSO failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`);
        }
      }
      throw new TraefikReconcileError(msg);
    }
  }

  /** Start an existing-but-stopped Traefik; if it can't bind its ports, recreate
   * with a reduced config (drop port mappings whose host port is occupied, or
   * fall back to last-good) so the dashboard is restored. The offending mapping
   * is left in the store — unrouted — so the operator can reach the dashboard
   * and remove it. (Layer 5) */
  private async startOrSelfHeal(c: Docker.Container, m: Mappings): Promise<void> {
    try {
      await c.start();
      this.lastGoodMappings = m;
      return;
    } catch (err) {
      useLogger().error(`[traefik-manager] Traefik start failed: ${err instanceof Error ? err.message : err}`);
    }
    const occupied = await this.occupiedHostPorts();
    const keptPorts = m.port.filter((pm) => !occupied.has(pm.externalPort));
    const fallback: Mappings = this.lastGoodMappings ?? { domain: m.domain, port: keptPorts };
    const dropped = m.port.length - fallback.port.length;
    await this.removeTraefik().catch(() => {});
    await this.writeTraefikConfig(fallback);
    try {
      await this.createTraefik(fallback);
      this.lastGoodMappings = fallback;
      useLogger().warn(
        `[traefik-manager] self-healed Traefik (dropped ${dropped} unbindable port mapping(s)) — dashboard restored`,
      );
    } catch (healErr) {
      useLogger().error(`[traefik-manager] self-heal failed: ${healErr instanceof Error ? healErr.message : healErr}`);
    }
  }

  /** Host ports the Traefik container for `m` will publish (80/443 web
   * entrypoints when needed, plus one per port mapping). */
  private hostPortsFor(m: Mappings): number[] {
    const ports: number[] = [];
    if (this.needsWebEntrypoints(m)) ports.push(80, 443);
    for (const pm of m.port) ports.push(pm.externalPort);
    return ports;
  }

  /** Host ports the currently-running Traefik already binds (from its inspect
   * data) — the baseline against which a reconcile's NEW ports are computed. */
  private runningHostPorts(info: Docker.ContainerInspectInfo): Set<number> {
    const ports = new Set<number>();
    for (const arr of Object.values(info.HostConfig?.PortBindings || {})) {
      for (const b of (arr as { HostPort?: string }[] | undefined) || []) {
        const n = Number(b?.HostPort);
        if (Number.isInteger(n)) ports.add(n);
      }
    }
    return ports;
  }

  /** Host ports currently published by some OTHER container (Traefik itself is
   * excluded — it is the one being recreated). Used to detect a conflict before
   * tearing down the working Traefik. */
  private async occupiedHostPorts(): Promise<Set<number>> {
    const ports = new Set<number>();
    const containers = await this.docker.listContainers({ all: false });
    for (const c of containers) {
      const names = (c.Names || []).map((n) => n.replace(/^\//, ''));
      if (names.includes(TRAEFIK_CONTAINER_NAME)) continue;
      for (const p of c.Ports || []) {
        if (p.PublicPort) ports.add(p.PublicPort);
      }
    }
    return ports;
  }

  /** Throw {@link TraefikPortConflictError} if any of `ports` is already taken
   * on the host by another container. Caught before any destructive action so
   * the running Traefik is never disturbed. (Layer 2) */
  private async preflightHostPorts(ports: number[]): Promise<void> {
    if (ports.length === 0) return;
    const occupied = await this.occupiedHostPorts();
    const clashes = [...new Set(ports.filter((p) => occupied.has(p)))];
    if (clashes.length > 0) {
      throw new TraefikPortConflictError(
        `Host port${clashes.length > 1 ? 's' : ''} ${clashes.join(', ')} already in use by another container — `
        + 'refusing to (re)create Traefik. Free the port or choose a different external port.',
      );
    }
  }

  private getDomainConfig(baseDomain: string): BaseDomainConfig | undefined {
    return this.config.baseDomainConfigs.find((c) => c.domain === baseDomain);
  }

  private getTlsConfig(baseDomain: string): Record<string, unknown> | undefined {
    const dc = this.getDomainConfig(baseDomain);
    if (!dc || dc.challengeType === 'none') return undefined;
    if (dc.challengeType === 'selfsigned') return {};
    if (dc.challengeType === 'http') return { certResolver: 'letsencrypt' };
    // Fail closed: only emit a DNS resolver when the challenge type is `dns`
    // AND a provider is set. An unknown/new ChallengeType (or a `dns` config
    // missing its provider) returns undefined rather than referencing a broken
    // `letsencrypt-dns-undefined` resolver.
    if (dc.challengeType === 'dns' && dc.dnsProvider) {
      return {
        certResolver: `letsencrypt-dns-${dc.dnsProvider}`,
        domains: [{ main: dc.domain, sans: [`*.${dc.domain}`] }],
      };
    }
    return undefined;
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
    // Fail closed (see getTlsConfig): only `dns` with a provider gets a resolver.
    if (dc.challengeType === 'dns' && dc.dnsProvider) {
      return {
        certResolver: `letsencrypt-dns-${dc.dnsProvider}`,
        domains: [{ main: host, sans: [`*.${host}`] }],
      };
    }
    return undefined;
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

  /**
   * Defense in depth at the point of YAML generation: strip backticks (and other
   * Traefik rule metacharacters) from a value before it is interpolated into a
   * backtick-delimited rule literal like Host(`…`)/HostSNI(`…`)/PathPrefix(`…`).
   * The domain-mapping store already validates host/path format, but a stray
   * backtick that slipped past upstream validation could otherwise break out of
   * the literal and inject arbitrary matcher syntax (routing-rule injection).
   */
  private static ruleLiteral(value: string): string {
    return value.replace(/[`)\\]/g, '');
  }

  private async writeTraefikConfig(m: Mappings): Promise<void> {
    const { domain: domainMappings, port: portMappings } = m;
    const config = {
      http: { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown>, middlewares: {} as Record<string, unknown> },
      tcp: { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown> },
    };

    // Dashboard router (only if base domain is configured with a dashboard subdomain)
    if (this.config.dashboardSubdomain && this.config.dashboardBaseDomain) {
      const dashHost = TraefikManager.ruleLiteral(`${this.config.dashboardSubdomain}.${this.config.dashboardBaseDomain}`);
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

    // Wildcard self-signed domain mappings need a per-host wildcard cert generated
    // before Traefik reads the file provider config. Collect the unique hosts
    // up front and make sure each has a cert on disk.
    const selfSignedWildcardHosts = new Set<string>();
    for (const m of domainMappings) {
      if (!m.wildcard) continue;
      const dc = this.getDomainConfig(m.baseDomain);
      if (dc?.challengeType !== 'selfsigned') continue;
      const host = m.subdomain ? `${m.subdomain}.${m.baseDomain}` : m.baseDomain;
      // Include the bare base domain too. init() eagerly generates base-domain
      // certs, but ensureWildcardCertForHost is idempotent (skips if the cert
      // already exists), so adding it here removes the fragile cross-method
      // invariant (writeTraefikConfig referencing a cert init() must have made).
      selfSignedWildcardHosts.add(host);
    }
    for (const host of selfSignedWildcardHosts) {
      await this.selfSignedCertManager.ensureWildcardCertForHost(host);
    }

    // Domain mappings (HTTP/HTTPS/TCP via web+websecure entrypoints).
    // Router/service/middleware names share one namespace via prefixes:
    // `tcp-`/`http-` (router+service), `strip-`/`auth-` (middlewares), all
    // suffixed with the sanitized mapping UUID. Port routers use `pm-<port>` and
    // the dashboard is the literal `dashboard`. A new router type must pick a
    // fresh prefix to stay collision-free. `safeId` is a UUID with non-alnum
    // chars stripped — unique because the source ids are UUIDs.
    for (const m of domainMappings) {
      const host = m.subdomain ? `${m.subdomain}.${m.baseDomain}` : m.baseDomain;
      const safeId = m.id.replace(/[^a-zA-Z0-9-]/g, '');

      if (m.protocol === 'tcp') {
        // TCP + wildcard requires TLS (HostSNI). The API rejects wildcard on
        // `http` ACME, so any TLS we see here is DNS or selfsigned — both can
        // issue wildcard certs.
        const tls = m.wildcard
          ? this.getWildcardTlsConfig(host, m.baseDomain)
          : this.getTlsConfig(m.baseDomain);
        const ruleHost = TraefikManager.ruleLiteral(host);
        const tcpRule = m.wildcard
          ? `HostSNI(\`${ruleHost}\`) || HostSNIRegexp(\`${this.hostRegexFor(ruleHost)}\`)`
          : `HostSNI(\`${ruleHost}\`)`;
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
          loadBalancer: { servers: [{ address: `${m.containerName}:${m.internalPort}` }] },
        };
      } else {
        const middlewares: string[] = [];

        const rulePath = m.path ? TraefikManager.ruleLiteral(m.path) : m.path;

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

        const ruleHost = TraefikManager.ruleLiteral(host);
        const hostClause = m.wildcard
          ? `(Host(\`${ruleHost}\`) || HostRegexp(\`${this.hostRegexFor(ruleHost)}\`))`
          : `Host(\`${ruleHost}\`)`;
        const rule = m.path
          ? `${hostClause} && PathPrefix(\`${rulePath}\`)`
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
          loadBalancer: { servers: [{ url: `http://${m.containerName}:${m.internalPort}` }] },
        };
      }
    }

    // Port mappings — each gets a dedicated TCP entrypoint (defined in Cmd)
    // and a catch-all TCP router that forwards to the worker. HostSNI(*) accepts
    // any connection regardless of TLS/SNI, so this works for raw TCP of any
    // protocol (HTTP, SSH, database, etc.).
    for (const m of portMappings) {
      const name = `pm-${m.externalPort}`;
      config.tcp.routers[name] = {
        rule: 'HostSNI(`*`)',
        service: name,
        entryPoints: [name],
      };
      config.tcp.services[name] = {
        loadBalancer: { servers: [{ address: `${m.containerName}:${m.internalPort}` }] },
      };
    }

    // Add self-signed TLS certificates to the file provider config — both the
    // per-base-domain wildcards generated at init() time and the per-host
    // wildcards generated above for wildcard subdomain mappings.
    const selfSignedBaseDomains = this.config.baseDomainConfigs.filter((c) => c.challengeType === 'selfsigned');
    if (selfSignedBaseDomains.length > 0 || selfSignedWildcardHosts.size > 0) {
      // Dedupe by host — a wildcard mapping on a bare base domain now also lands
      // in selfSignedWildcardHosts (see the cert-ensure loop above), so guard
      // against listing the same cert file twice.
      const certHosts = new Set<string>();
      const certs: { certFile: string; keyFile: string }[] = [];
      for (const dc of selfSignedBaseDomains) certHosts.add(dc.domain);
      for (const host of selfSignedWildcardHosts) certHosts.add(host);
      for (const host of certHosts) {
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

    const configPath = join(this.config.dataDir, TRAEFIK_CONFIG_FILENAME);
    await mkdir(dirname(configPath), { recursive: true });
    // lineWidth: 0 disables line folding so each Traefik rule stays on a single
    // line — long router rules with `||`/`&&` are far more readable unwrapped.
    await writeFile(configPath, stringifyYaml(clean, { lineWidth: 0 }));
  }

  buildCmd(m: Mappings): string[] {
    const cmd: string[] = [
      `--providers.file.filename=/data/${TRAEFIK_CONFIG_FILENAME}`,
      '--providers.file.watch=true',
      '--ping=true',
    ];

    if (this.needsWebEntrypoints(m)) {
      cmd.push('--entrypoints.web.address=:80', '--entrypoints.websecure.address=:443');
    }

    // One entrypoint per port mapping, deterministically ordered by external
    // port. The order must match createTraefik()'s PortBindings construction
    // so drift detection does not thrash.
    for (const pm of this.sortedPortMappings(m)) {
      cmd.push(`--entrypoints.pm-${pm.externalPort}.address=:${pm.externalPort}`);
    }

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

  private sortedPortMappings(m: Mappings): PortMapping[] {
    return [...m.port].sort((a, b) => a.externalPort - b.externalPort);
  }

  private buildExposedPorts(m: Mappings): Record<string, object> {
    const exposed: Record<string, object> = {};
    if (this.needsWebEntrypoints(m)) {
      exposed['80/tcp'] = {};
      exposed['443/tcp'] = {};
    }
    for (const pm of this.sortedPortMappings(m)) {
      exposed[`${pm.externalPort}/tcp`] = {};
    }
    return exposed;
  }

  private buildPortBindings(m: Mappings): PortBindings {
    const bindings: PortBindings = {};
    if (this.needsWebEntrypoints(m)) {
      bindings['80/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '80' }];
      bindings['443/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '443' }];
    }
    for (const pm of this.sortedPortMappings(m)) {
      const hostIp = pm.type === 'localhost' ? '127.0.0.1' : '0.0.0.0';
      bindings[`${pm.externalPort}/tcp`] = [{ HostIp: hostIp, HostPort: String(pm.externalPort) }];
    }
    return bindings;
  }

  private hasContainerConfigDrift(info: Docker.ContainerInspectInfo, m: Mappings): boolean {
    const expectedCmd = this.buildCmd(m);
    const actualCmd = info.Config?.Cmd || [];
    if (JSON.stringify(expectedCmd) !== JSON.stringify(actualCmd)) return true;

    const expectedBindings = this.buildPortBindings(m);
    const actualBindings = info.HostConfig?.PortBindings || {};
    if (!portBindingsMatch(expectedBindings, actualBindings)) return true;

    const expectedEnv = this.buildEnv();
    if (expectedEnv.length > 0) {
      const actualEnvSet = new Set(info.Config?.Env || []);
      for (const e of expectedEnv) {
        if (!actualEnvSet.has(e)) return true;
      }
    }
    return false;
  }

  private async createTraefik(m: Mappings): Promise<void> {
    // A freshly created container always reads the current config file, so the
    // "config was just created" restart hint no longer applies — clear it so a
    // later reconcile that finds the running container does not trigger a
    // spurious restart.
    this.configFileJustCreated = false;

    const hasAcmeCerts = this.config.baseDomainConfigs.some((c) => c.challengeType === 'http' || c.challengeType === 'dns');
    if (hasAcmeCerts && !this.config.acmeEmail) {
      useLogger().warn('[traefik-manager] ACME_EMAIL not configured — TLS certificates will not be issued');
    }

    await this.storageManager.ensureCertDir();

    const image = this.config.traefikImage;

    await this.ensureImage(image);

    const cmd = this.buildCmd(m);
    const env = this.buildEnv();
    const exposedPorts = this.buildExposedPorts(m);
    const portBindings = this.buildPortBindings(m);

    const container = await this.docker.createContainer({
      Image: image,
      name: TRAEFIK_CONTAINER_NAME,
      Cmd: cmd,
      ...(env.length > 0 ? { Env: env } : {}),
      ExposedPorts: exposedPorts,
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
        PortBindings: portBindings,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: [
          this.storageManager.getDataBind(true),
          this.storageManager.getCertBind(),
        ],
      },
    });

    try {
      await container.start();
    } catch (err) {
      // Docker rejects the start when a host port can't be bound (e.g. another
      // process already owns it). Tear the half-created container down so the
      // caller's rollback/self-heal starts from a clean slate, then rethrow.
      await container.remove({ force: true }).catch(() => {});
      throw err;
    }
    useLogger().info(
      `[traefik-manager] created Traefik container (${m.domain.length} domain, ${m.port.length} port mapping(s))`,
    );
    useLogCollector().attach(TRAEFIK_CONTAINER_NAME, container.id, 'traefik').catch((err) =>
      useLogger().warn(`[traefik-manager] log attach failed: ${err instanceof Error ? err.message : err}`),
    );
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      useLogger().info(`[traefik-manager] pulling image ${image}...`);
      const stream = await this.docker.pull(image);
      // Guard the pull with a deadline. Every reconcile()/forceRecreate() chains
      // onto a single reconcileQueue, so a registry that stalls mid-pull (held
      // connection, no bytes) would otherwise block *all* future Traefik
      // reconciles forever. On timeout we destroy the stream and reject so the
      // queue advances and the next reconcile can retry.
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          (stream as { destroy?: () => void }).destroy?.();
          reject(new Error(`image pull for ${image} timed out after ${TRAEFIK_IMAGE_PULL_TIMEOUT_MS}ms`));
        }, TRAEFIK_IMAGE_PULL_TIMEOUT_MS);
        this.docker.modem.followProgress(stream, (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
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

function portBindingsMatch(expected: PortBindings, actual: PortBindings | Record<string, unknown>): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (expectedKeys.length !== actualKeys.length) return false;
  for (let i = 0; i < expectedKeys.length; i++) {
    if (expectedKeys[i] !== actualKeys[i]) return false;
    const e = expected[expectedKeys[i]!]!;
    const a = (actual as PortBindings)[actualKeys[i]!];
    if (!Array.isArray(a) || a.length !== e.length) return false;
    for (let j = 0; j < e.length; j++) {
      if (e[j]!.HostIp !== (a[j] as { HostIp?: string }).HostIp || e[j]!.HostPort !== (a[j] as { HostPort?: string }).HostPort) {
        return false;
      }
    }
  }
  return true;
}
