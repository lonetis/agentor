---
name: agentor-port-mapping
description: Expose a port from your worker to the host machine or network. Use when you need to make a dev server, API, database, or any service running inside this container accessible from outside.
user-invocable: false
---

# Expose a port from your worker to the host machine or network

Use this skill when you need to make a service running inside this worker container accessible from outside — for example, to let the user visit a web app you're developing, expose a dev server, or make an API reachable from the host machine or the internet.

## How it works

Your worker runs inside an isolated Docker container. Ports inside the container are not directly reachable from the host machine. The orchestrator routes host ports to your worker through a shared Traefik reverse proxy — each mapping becomes a dedicated TCP entrypoint that forwards traffic to your worker on the Docker bridge network.

There are two mapping types:
- **localhost** — The port is only accessible from the host machine (127.0.0.1)
- **external** — The port is accessible from any machine on the network (0.0.0.0)

## Authentication

All endpoints described here live under `$ORCHESTRATOR_URL/api/worker-self/*` and **do not require any session cookie or API key**. The orchestrator identifies your worker automatically by its source IP on the `agentor-net` Docker network — every port mapping you create or delete is scoped to *this* worker.

`$ORCHESTRATOR_URL` is a pre-set environment variable pointing at the orchestrator's internal URL (e.g. `http://agentor-orchestrator:3000`).

## API Reference

### Confirm worker-self auth works

```bash
curl "$ORCHESTRATOR_URL/api/worker-self/info"
```

Returns `{ workerName, containerName, userId, status, displayName }` — useful as a quick sanity check that the orchestrator can see your worker.

### Check port mapping status

```bash
curl "$ORCHESTRATOR_URL/api/worker-self/port-mapper/status"
```

Returns `totalMappings`, `localhostCount`, and `externalCount` — the total count of mappings managed by the orchestrator.

### Create a port mapping

```bash
curl -X POST "$ORCHESTRATOR_URL/api/worker-self/port-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "externalPort": 9000,
    "type": "localhost",
    "internalPort": 3000
  }'
```

This maps host port 9000 to port 3000 inside *this* worker. The user can then open `http://localhost:9000` on the host.

**Required fields:**
- `externalPort` (integer) — The port on the host machine (1-65535)
- `type` — `"localhost"` (host only) or `"external"` (network-accessible)
- `internalPort` (integer) — The port your service listens on inside this container (1-65535)

`workerId` / `workerName` are not accepted — the target worker is always the caller.

### List your worker's port mappings

```bash
curl "$ORCHESTRATOR_URL/api/worker-self/port-mappings"
```

Returns a JSON array of port mappings owned by *this* worker (mappings owned by sibling workers are filtered out). Each entry includes `externalPort`, `type`, `workerName`, `containerName`, and `internalPort`.

### Delete a port mapping

```bash
curl -X DELETE "$ORCHESTRATOR_URL/api/worker-self/port-mappings/9000"
```

Removes the mapping on host port 9000. Replace `9000` with the external port number. Idempotent — returns success even if the mapping doesn't exist. Returns `403` if the mapping belongs to a different worker.

## Common use cases

1. **Dev server** — Start a server on port 3000 inside the container, map it to a host port so the user can access it in their browser
2. **API endpoint** — Expose a backend service for external testing or webhook delivery
3. **Database** — Expose a database port for access from host tools (use `localhost` type for security)
