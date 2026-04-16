# Networking

## Port Mapper

The port mapper runs as a separate Docker container (`agentor-mapper`), managed by the orchestrator via dockerode. Mappings are persisted to `<DATA_DIR>/port-mappings.json` and survive orchestrator restarts. They also survive worker lifecycle events — stop/restart, archive/unarchive, and rebuild all preserve the mapping. Mappings are only removed when the worker is permanently deleted. Records are keyed by the stable worker name (not the Docker container ID), so the mapper continues routing to the worker after it comes back under a new container ID. The `workerId` field is updated automatically on rebuild and unarchive via `reassignWorkerMappings`.

**Architecture:**
- `PortMappingStore` (`port-mapping-store.ts`): Persists mappings to disk, extends `JsonStore<number, PortMapping>`
- `MapperManager` (`mapper-manager.ts`): Manages the mapper container lifecycle. On mapping changes, it writes to the store, then reconciles the mapper container (stop+remove+recreate with updated Docker port bindings). Serialized via promise queue.
- `mapper/proxy.mjs`: Standalone Node.js script that reads `/data/port-mappings.json` and creates `net.createServer()` TCP proxies per mapping

**Container lifecycle:**
- Created on first mapping, removed when all mappings are deleted (no idle container)
- Recreated with new port bindings whenever mappings change
- Labeled `agentor.managed=mapper` (won't match `=true` filter used for worker listing)
- Shares the data volume read-only (`DATA_VOLUME:/data:ro`)
- Connected to `agentor-net` for Docker DNS resolution of worker container names

**Port types (no fixed ranges — any port allowed):**
- **localhost**: Docker publishes with `127.0.0.1` binding (host only)
- **external**: Docker publishes with `0.0.0.0` binding (accessible from network)

## Domain Mapping (Traefik)

Domain-based routing via a Traefik reverse proxy container. Optional — requires `BASE_DOMAINS` env var. Supports multiple base domains with per-domain TLS challenge configuration. Each domain mapping specifies which base domain it uses. Supports HTTP, HTTPS, and TCP protocols with optional HTTP basic auth per mapping. Subdomain is optional — when omitted (empty string), the bare base domain itself is mapped directly (e.g., `example.com` instead of `sub.example.com`). Each base domain can independently be mapped bare or with subdomains. Path-based routing is supported for HTTP/HTTPS — different paths on the same domain can route to different workers (e.g., `/api` to backend, `/app` to frontend). The path prefix is automatically stripped before forwarding (StripPrefix middleware).

Mappings can also be marked **wildcard**, in which case the router matches any single-label prefix of the host alongside the exact host — e.g. a wildcard mapping on `a.example.com` routes both `a.example.com` and `foo.a.example.com` to the same worker. Wildcard also works on the bare base domain (empty subdomain) to route every first-level subdomain of `example.com` at once. Wildcard matching is single-label deep, matching DNS wildcard and wildcard-certificate semantics (`*.a.example.com` does not cover `x.y.a.example.com`). Wildcard routers are assigned explicit low priority so an exact-host mapping always wins over a wildcard that would otherwise match the same name. All three protocols support wildcard: HTTP and HTTPS routers use `Host(…) || HostRegexp(…)`; TCP routers use `HostSNI(…) || HostSNIRegexp(…)` — TCP wildcard therefore requires TLS (SNI is a TLS concept), which in turn requires the base domain to use `:dns:provider` or `:selfsigned`.

**Wildcard + TLS:**
- **`none`** (plain HTTP, no TLS): router simply adds a `HostRegexp` alternate — no certificate needed.
- **`dns:provider`**: the wildcard router sets `tls.domains = [{ main: host, sans: ['*.host'] }]`, so Traefik asks Let's Encrypt for a single cert containing `host` + `*.host` via DNS-01. Only `host` appears in Certificate Transparency logs as a named leaf (plus the wildcard SAN), avoiding per-subdomain CT leakage.
- **`selfsigned`**: a per-host wildcard cert (`*.host` with SAN `host`) is generated lazily the first time a wildcard mapping targets that host, signed by the local CA, and reused for subsequent mappings. The router uses empty `tls: {}` and Traefik picks the cert by SNI from the file provider.
- **`http` (HTTP-01 ACME)**: rejected with 400 — HTTP-01 cannot issue wildcard certificates, and issuing a new cert per discovered subdomain would leak the subdomain inventory to Certificate Transparency logs.

Like port mappings, domain mappings are keyed by the worker name and persist across worker stop/restart, archive/unarchive, and rebuild — only permanent deletion removes them. Traefik routes to the worker by name via Docker DNS, so a rebuilt/unarchived worker is picked up automatically after its new container joins the network.

### TLS Challenge Types

Each base domain in `BASE_DOMAINS` specifies its own TLS challenge type:

| Format | Challenge | TLS | Wildcard | Requires |
|--------|-----------|-----|----------|----------|
| `domain.com` | none | No | No | Nothing |
| `domain.com:http` | HTTP-01 | Yes | No | Port 80 publicly accessible |
| `domain.com:dns:provider` | DNS-01 | Yes | Yes (`*.domain.com`) | DNS provider credentials |
| `domain.com:selfsigned` | Self-signed CA | Yes | Yes (`*.domain.com`) | User trusts the CA cert in browser |

Example: `BASE_DOMAINS=a.com:dns:cloudflare,b.com:http,c.com,d.com:selfsigned`

**DNS provider configuration** uses `ACME_DNS_<PROVIDER>_*` env vars (provider name uppercased, hyphens → underscores):
- `ACME_DNS_<PROVIDER>_VARS` — comma-separated env var names to forward to Traefik container (required)
- `ACME_DNS_<PROVIDER>_DELAY` — seconds to wait before DNS check (optional)
- `ACME_DNS_<PROVIDER>_RESOLVERS` — comma-separated DNS resolvers for verification (optional)

**Protocol validation:** HTTPS and TCP mappings require TLS — the API rejects them for bare (no challenge) domains. HTTP protocol mappings work on all domains.

### Certificate Resolvers

Traefik certificate resolvers are created dynamically based on configured challenge types:
- `letsencrypt` — HTTP-01 (created when any `:http` domain exists)
- `letsencrypt-dns-<provider>` — DNS-01 per provider (e.g., `letsencrypt-dns-cloudflare`)

DNS-challenged domains get wildcard TLS: `{ certResolver, domains: [{ main, sans: ["*.domain"] }] }`

### Self-Signed Certificates

Domains configured with `:selfsigned` use a locally generated CA to issue wildcard certificates. No external DNS or Let's Encrypt needed — ideal for development or private networks.

**Architecture:**
- `SelfSignedCertManager` (`selfsigned-certs.ts`): Generates and stores a root CA certificate + per-domain wildcard certificates using `node-forge`
- CA cert (10-year validity) + domain certs (5-year) stored in `<DATA_DIR>/selfsigned-certs/`
- Certs are generated on first startup and reused across restarts (persisted in data directory)
- Traefik loads certs via its file provider config (`tls.certificates` section in `traefik-config.json`)
- Self-signed routers use `tls: {}` (empty — Traefik auto-matches the certificate by SNI from loaded certs)
- CA cert downloadable via `GET /api/domain-mapper/ca-cert` and from the dashboard UI ("CA cert" button)
- Each domain gets a wildcard cert with SANs: `domain.com` + `*.domain.com`
- Mixed configurations work: some domains can use `:selfsigned` while others use `:http` or `:dns:provider`

### Config Drift Detection

On reconcile, `TraefikManager` compares the running container's `Cmd` and DNS-related `Env` entries against expected values (from `buildCmd()`/`buildEnv()`). On drift (e.g., added/removed DNS providers, changed env vars), the container is automatically recreated.

### Traefik Container Architecture

- `DomainMappingStore` (`domain-mapping-store.ts`): Persists mappings to `<DATA_DIR>/domain-mappings.json`, extends `JsonStore<string, DomainMapping>`. Each mapping includes `baseDomain` and optional `path` fields. Uniqueness checked on `subdomain + baseDomain + path` per protocol (same subdomain can exist on different base domains; same domain can have different path prefixes).
- `TraefikManager` (`traefik-manager.ts`): Manages the `agentor-traefik` container lifecycle. On mapping changes, writes a Traefik file provider config (`traefik-config.json`), then ensures the Traefik container exists. Uses `providers.file.watch=true` so config changes are picked up without container restart. Serialized via promise queue. Routes use per-mapping `baseDomain` + `getTlsConfig()` for per-domain cert resolver selection. Dashboard uses `dashboardBaseDomain` from config. `buildCmd()` constructs Traefik CLI args with per-challenge-type resolvers. `buildEnv()` collects DNS provider env vars. `hasContainerConfigDrift()` detects when running container config diverges from expected.
- Traefik container: publishes ports 80 and 443, receives DNS provider env vars, uses Let's Encrypt ACME with challenge-specific resolvers
- Dashboard subdomain: if `DASHBOARD_SUBDOMAIN` is set, the orchestrator dashboard is accessible at `<DASHBOARD_SUBDOMAIN>.<DASHBOARD_BASE_DOMAIN>` (defaults to first domain in `BASE_DOMAINS`). Uses the dashboard domain's challenge type for TLS (or plain HTTP if no challenge).

**Container lifecycle:**
- Created when mappings exist or dashboard subdomain is configured, removed when both are empty
- Config-only updates (no container restart needed) — Traefik file provider watches for changes
- Container recreated on Cmd/Env drift (e.g., adding a DNS provider triggers recreate)
- Labeled `agentor.managed=traefik`
- Shares the data volume read-only (`DATA_VOLUME:/data:ro`) for reading `traefik-config.json`
- Uses a separate named volume (`agentor-traefik-certs`) for Let's Encrypt certificate storage
- Connected to `agentor-net` for Docker DNS resolution of worker container names

**Basic auth:** SHA1 htpasswd format generated in `traefik-manager.ts` using Node.js `crypto.createHash('sha1')`. Applied as Traefik middleware per-mapping. The dashboard subdomain also supports basic auth via `DASHBOARD_AUTH_USER` and `DASHBOARD_AUTH_PASSWORD` env vars (both required to enable).
