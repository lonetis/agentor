---
name: agentor-domain-mapping
description: Map domains, subdomains, paths, and wildcard subdomains to ports in your worker. Use when you need to serve traffic on a proper domain name with HTTPS/TLS, set up webhook endpoints, expose public-facing services, or route by URL path.
user-invocable: false
---

# Map domains, subdomains, and paths to ports in your worker

Use this skill when you need to make a service accessible via a proper domain name (e.g. `myapp.example.com`) instead of just an IP and port. Supports subdomain routing, path-based routing, wildcard subdomain matching, HTTP/HTTPS/TCP protocols, basic auth protection, and batch creation of multiple mappings at once.

## How it works

The orchestrator manages a **Traefik reverse proxy** that routes incoming requests based on domain names to the correct worker and port. TLS certificates are handled automatically — either via Let's Encrypt (HTTP-01 or DNS-01 challenges) or self-signed certificates, depending on how the base domain is configured.

Domain mapping is only available when the orchestrator has base domains configured. Always check availability first.

## API Reference

All requests go to the orchestrator at `$ORCHESTRATOR_URL`. Your container is identified by `$WORKER_CONTAINER_NAME`. Both are pre-set environment variables.

### Check availability and base domain configuration

```bash
curl "$ORCHESTRATOR_URL/api/domain-mapper/status"
```

Returns:
- `enabled` (boolean) — Whether domain mapping is available
- `baseDomains` (string[]) — Available base domains
- `baseDomainConfigs` (array) — Per-domain details: `domain`, `challengeType` (`"none"`, `"http"`, `"dns"`, or `"selfsigned"`), and optional `dnsProvider`
- `totalMappings` (integer) — Number of active mappings
- `hasSelfSignedCa` (boolean) — Whether any base domain uses self-signed certificates

If `enabled` is `false`, domain mapping is not configured and the other endpoints will not work.

The `challengeType` determines what protocols and features are available per base domain:

| Challenge type | TLS | HTTPS/TCP | Wildcard subdomain |
|----------------|-----|-----------|-------------------|
| `none` | No | No | Yes (HTTP only) |
| `http` | Yes (Let's Encrypt HTTP-01) | Yes | No |
| `dns` | Yes (Let's Encrypt DNS-01) | Yes | Yes |
| `selfsigned` | Yes (local CA) | Yes | Yes |

### Create a domain mapping

```bash
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "myapp",
    "baseDomain": "example.com",
    "protocol": "https",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000
  }'
```

This makes `https://myapp.example.com` route to port 3000 inside your container.

**Required fields:**
- `baseDomain` (string) — Must be one of the domains from the status endpoint
- `protocol` — `"http"`, `"https"`, or `"tcp"`. HTTPS and TCP require TLS to be configured on the base domain (challenge type `http`, `dns`, or `selfsigned`)
- `workerName` (string) — Always use `$WORKER_CONTAINER_NAME`
- `internalPort` (integer) — The port your service listens on inside this container (1-65535)

**Optional fields:**
- `subdomain` (string) — The subdomain prefix. Leave empty (`""`) or omit to map the bare base domain itself (e.g. `example.com` instead of `something.example.com`). Multi-level subdomains are supported (e.g. `"api.v2"` for `api.v2.example.com`)
- `path` (string) — URL path prefix for routing (e.g. `"/api"`). Must start with `/`. The path prefix is stripped before forwarding — a request to `/api/users` with `path: "/api"` arrives at the worker as `/users`. Not supported for TCP protocol
- `wildcard` (boolean) — When `true`, the mapping also matches any single-label prefix of the host. For example, a wildcard on `app.example.com` also matches `anything.app.example.com`. Requires the base domain's challenge type to be `none`, `dns`, or `selfsigned` — HTTP-01 ACME (`http`) cannot issue wildcard certificates. Default: `false`
- `basicAuth` (object) — `{ "username": "user", "password": "pass" }` to protect with HTTP basic authentication. Not supported for TCP protocol. Requires both username and password

### Subdomain routing

Map different subdomains to different services:

```bash
# Frontend at app.example.com
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "app",
    "baseDomain": "example.com",
    "protocol": "https",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000
  }'

# API at api.example.com
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "api",
    "baseDomain": "example.com",
    "protocol": "https",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 8080
  }'
```

Leave `subdomain` empty to map the bare base domain itself (`example.com`).

### Path-based routing

Route different URL paths on the same domain to different ports or workers:

```bash
# Route /api/* to backend (port 8080)
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "baseDomain": "example.com",
    "path": "/api",
    "protocol": "https",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 8080
  }'

# Route /docs/* to docs server (port 4000)
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "baseDomain": "example.com",
    "path": "/docs",
    "protocol": "https",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 4000
  }'
```

The path prefix is stripped before forwarding, so `/api/users` becomes `/users` at the worker. Longer paths take priority over shorter ones. Path routing is not available for TCP.

### Wildcard subdomain routing

Match all single-label subdomains of a host with a single mapping:

```bash
# Route *.app.example.com (and app.example.com itself) to port 3000
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "app",
    "baseDomain": "example.com",
    "protocol": "https",
    "wildcard": true,
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000
  }'
```

This routes both `app.example.com` and `anything.app.example.com` to port 3000. Deeper nesting (`a.b.app.example.com`) is not matched — wildcards are single-label deep, matching DNS wildcard semantics.

Use an empty subdomain to route all first-level subdomains of the base domain:

```bash
# Route *.example.com to port 3000
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "",
    "baseDomain": "example.com",
    "protocol": "https",
    "wildcard": true,
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000
  }'
```

An exact-host mapping always takes priority over a wildcard — you can create a wildcard catch-all and still override specific subdomains with dedicated mappings.

Wildcard requires the base domain's challenge type to be `none`, `dns`, or `selfsigned`. It is rejected for `http` (HTTP-01 ACME cannot issue wildcard certificates).

### Batch creation

Create multiple domain mappings in a single request (Traefik is reconciled only once):

```bash
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "subdomain": "app",
        "baseDomain": "example.com",
        "protocol": "https",
        "workerName": "'"$WORKER_CONTAINER_NAME"'",
        "internalPort": 3000
      },
      {
        "subdomain": "api",
        "baseDomain": "example.com",
        "protocol": "https",
        "workerName": "'"$WORKER_CONTAINER_NAME"'",
        "internalPort": 8080
      }
    ]
  }'
```

Each item supports the same fields as the single create endpoint. The batch fails on the first validation error.

### Basic auth protection

Protect HTTP or HTTPS mappings with basic authentication:

```bash
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "staging",
    "baseDomain": "example.com",
    "protocol": "https",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000,
    "basicAuth": {
      "username": "admin",
      "password": "secretpassword"
    }
  }'
```

Both `username` and `password` are required when `basicAuth` is provided. Not available for TCP protocol.

### TCP passthrough

Route raw TCP traffic via TLS SNI matching (requires TLS on the base domain):

```bash
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "db",
    "baseDomain": "example.com",
    "protocol": "tcp",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 5432
  }'
```

TCP mappings route at the transport layer using TLS SNI — path and basic auth are not available. TCP wildcard requires TLS (`dns` or `selfsigned` challenge type) since SNI is a TLS concept.

### List all domain mappings

```bash
curl "$ORCHESTRATOR_URL/api/domain-mappings"
```

Returns a JSON array of all active domain mappings. Each entry includes `id`, `subdomain`, `baseDomain`, `path`, `protocol`, `wildcard`, `workerId`, `workerName`, `internalPort`, and optional `basicAuth`.

### Delete a domain mapping

```bash
curl -X DELETE "$ORCHESTRATOR_URL/api/domain-mappings/MAPPING_ID"
```

Replace `MAPPING_ID` with the `id` from the list response. Idempotent — returns success even if the mapping doesn't exist.

## Common use cases

1. **Public web app** — Deploy a site at `https://myapp.example.com` with automatic TLS
2. **Webhook receiver** — Create an HTTPS endpoint for GitHub webhooks, Stripe callbacks, etc.
3. **API gateway** — Expose a backend API on a clean domain with optional basic auth
4. **Path-based routing** — Route `/api` to a backend and `/app` to a frontend on the same domain
5. **Wildcard tenant routing** — Route `*.app.example.com` to a multi-tenant service that reads the subdomain from the `Host` header
6. **Protected staging** — Serve a staging environment behind basic auth on `staging.example.com`
7. **Database access** — Expose a database via TCP passthrough on `db.example.com:443`
8. **Batch setup** — Create all domain mappings for a project in a single API call
