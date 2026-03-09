# Networking

## Port Mapper

The port mapper runs as a separate Docker container (`agentor-mapper`), managed by the orchestrator via dockerode. Mappings are persisted to `<DATA_DIR>/port-mappings.json` and survive restarts.

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

Domain-based routing via a Traefik reverse proxy container. Optional — requires `BASE_DOMAINS` env var. Supports multiple base domains with per-domain TLS challenge configuration. Each domain mapping specifies which base domain it uses. Supports HTTP, HTTPS, and TCP protocols with optional HTTP basic auth per mapping. Subdomain is optional — when omitted (empty string), the bare base domain itself is mapped directly (e.g., `example.com` instead of `sub.example.com`). Each base domain can independently be mapped bare or with subdomains.

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

- `DomainMappingStore` (`domain-mapping-store.ts`): Persists mappings to `<DATA_DIR>/domain-mappings.json`, extends `JsonStore<string, DomainMapping>`. Each mapping includes a `baseDomain` field. Uniqueness checked on `subdomain + baseDomain` (same subdomain can exist on different base domains).
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
