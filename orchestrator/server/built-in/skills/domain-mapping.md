---
name: domain-mapping
description: Map a domain or subdomain to a port in your worker. Use when you need to serve traffic on a proper domain name with HTTPS, set up webhook endpoints, or expose a public-facing service.
user-invocable: false
---

# Map a domain or subdomain to a port in your worker

Use this skill when you need to make a service accessible via a proper domain name (e.g. `myapp.example.com`) instead of just an IP and port. This is useful for public-facing services, webhook endpoints that require HTTPS, or any scenario where a clean URL matters.

## How it works

The orchestrator manages a **Traefik reverse proxy** that routes incoming requests based on domain names to the correct worker and port. It handles TLS certificates automatically via Let's Encrypt.

Domain mapping is only available when the orchestrator has base domains configured. Always check availability first before attempting to create a mapping.

## API Reference

All requests go to the orchestrator at `$ORCHESTRATOR_URL`. Your container is identified by `$WORKER_CONTAINER_NAME`. Both are pre-set environment variables.

### Check if domain mapping is available

```bash
curl "$ORCHESTRATOR_URL/api/domain-mapper/status"
```

Returns `enabled: true/false` and a list of available `baseDomains`. If `enabled` is `false`, domain mapping is not configured and the other endpoints will not work.

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
- `protocol` — `"http"`, `"https"`, or `"tcp"`. HTTPS and TCP require TLS to be configured on the base domain
- `workerName` (string) — Always use `$WORKER_CONTAINER_NAME`
- `internalPort` (integer) — The port your service listens on inside this container (1-65535)

**Optional fields:**
- `subdomain` (string) — The subdomain prefix. Leave empty (`""`) to map the bare base domain itself (e.g. `example.com` instead of `something.example.com`)
- `basicAuth` (object) — `{ "username": "user", "password": "pass" }` to protect with HTTP basic authentication

### List all domain mappings

```bash
curl "$ORCHESTRATOR_URL/api/domain-mappings"
```

Returns a JSON array of all active domain mappings across all workers. Each entry includes an `id` field needed for deletion.

### Delete a domain mapping

```bash
curl -X DELETE "$ORCHESTRATOR_URL/api/domain-mappings/MAPPING_ID"
```

Replace `MAPPING_ID` with the `id` from the list response.

## Common use cases

1. **Public web app** — Deploy a site accessible at `https://myapp.example.com` with automatic TLS
2. **Webhook receiver** — Create an HTTPS endpoint for GitHub webhooks, Stripe callbacks, etc.
3. **API gateway** — Expose a backend API on a clean domain with optional basic auth protection
