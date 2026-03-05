---
name: port-mapping
description: Expose a port from your worker to the host machine or network. Use when you need to make a dev server, API, database, or any service running inside this container accessible from outside.
user-invocable: false
---

# Expose a port from your worker to the host machine or network

Use this skill when you need to make a service running inside this worker container accessible from outside — for example, to let the user visit a web app you're developing, expose a dev server, or make an API reachable from the host machine or the internet.

## How it works

Your worker runs inside an isolated Docker container. Ports inside the container are not directly reachable from the host machine. The orchestrator provides a **port mapper** that creates TCP proxies from host ports to your internal ports.

There are two mapping types:
- **localhost** — The port is only accessible from the host machine (127.0.0.1)
- **external** — The port is accessible from any machine on the network (0.0.0.0)

## API Reference

All requests go to the orchestrator at `$ORCHESTRATOR_URL`. Your container is identified by `$WORKER_CONTAINER_NAME`. Both are pre-set environment variables.

### Create a port mapping

```bash
curl -X POST "$ORCHESTRATOR_URL/api/port-mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "externalPort": 9000,
    "type": "localhost",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000
  }'
```

This maps host port 9000 to port 3000 inside your container. The user can then open `http://localhost:9000` on the host.

**Required fields:**
- `externalPort` (integer) — The port on the host machine (1-65535)
- `type` — `"localhost"` (host only) or `"external"` (network-accessible)
- `workerName` (string) — Always use `$WORKER_CONTAINER_NAME`
- `internalPort` (integer) — The port your service listens on inside this container (1-65535)

### List all port mappings

```bash
curl "$ORCHESTRATOR_URL/api/port-mappings"
```

Returns a JSON array of all active port mappings across all workers.

### Delete a port mapping

```bash
curl -X DELETE "$ORCHESTRATOR_URL/api/port-mappings/9000"
```

Removes the mapping on host port 9000. Replace `9000` with the external port number.

## Common use cases

1. **Dev server** — Start a server on port 3000 inside the container, map it to a host port so the user can access it in their browser
2. **API endpoint** — Expose a backend service for external testing or webhook delivery
3. **Database** — Expose a database port for access from host tools (use `localhost` type for security)
