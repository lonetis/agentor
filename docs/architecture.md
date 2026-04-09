# Architecture

## Container Overview

```
Browser (Vue 3/Nuxt UI) <--HTTP/JSON--> Orchestrator (Nuxt 3/Nitro) <--dockerode exec--> Worker (tmux/agent)
Browser (xterm.js)       <--WebSocket--> Nitro (crossws)             <--docker stream--> Worker (tmux)
Browser (noVNC iframe)   <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (websockify <--> x11vnc <--> Xvfb)
Browser (code-server)    <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (code-server on port 8443)
Orchestrator             <--docker exec-> apps/*/manage.sh (start/stop/list app instances in worker)
Orchestrator (MapperManager)  <--dockerode--> Mapper container (TCP proxies to worker internal ports)
Orchestrator (TraefikManager) <--dockerode--> Traefik container (domain-based reverse proxy, TLS)
```

Four managed containers:
- **Orchestrator**: Nuxt 3 app (SPA mode) with Nitro server, serving dashboard + managing workers, mapper, and Traefik containers via Docker socket
- **Mapper**: Lightweight Node.js container running TCP reverse proxies. Managed by the orchestrator via dockerode — created/recreated when port mappings change, removed when empty.
- **Traefik**: Reverse proxy for domain-based routing with Let's Encrypt TLS. Managed by the orchestrator — created when domain mappings or dashboard subdomain are configured, removed when empty. Optional (requires `BASE_DOMAINS` env var).
- **Workers**: Single unified Docker image (`agentor-worker`, Ubuntu 24.04) with all agent CLIs pre-installed, running in tmux, plus an integrated display stack (Xvfb + fluxbox + x11vnc + noVNC on port 6080), code-server (VS Code on port 8443), and Chromium. Each worker is a single container with all agents available.

## Storage Modes

The orchestrator supports two storage modes, auto-detected from how `/data` is mounted:

| Mode | Mount type | Detection | Worker data storage |
|------|-----------|-----------|-------------------|
| **Volume** | `agentor-data:/data` | `Type: "volume"` | Docker named volumes (`<name>-workspace`, `<name>-docker`, `agentor-traefik-certs`) |
| **Directory** | `./data:/data` | `Type: "bind"` | Subdirectories under the data directory on the host |

Switch modes by changing one line in the compose file — no env vars needed. `StorageManager` (`orchestrator/server/utils/storage.ts`) self-inspects the orchestrator container on startup to determine the mount type.

### Directory Layout (directory mode)

```
/data/
├── workers.json
├── port-mappings.json
├── domain-mappings.json
├── traefik-config.json
├── workspaces/          ← worker workspace dirs
│   ├── agentor-worker-happy-panda/
│   └── agentor-worker-cool-tiger/
├── agents/              ← agent config dirs (~/.claude, ~/.gemini, etc.)
│   ├── agentor-worker-happy-panda/
│   │   ├── .claude/     ← symlinked to ~/.claude
│   │   ├── .gemini/     ← symlinked to ~/.gemini
│   │   ├── .codex/      ← symlinked to ~/.codex
│   │   ├── .agents/     ← symlinked to ~/.agents
│   │   └── .claude.json ← symlinked to ~/.claude.json
│   └── agentor-worker-cool-tiger/
└── traefik-certs/       ← ACME certificates
    └── acme.json
```

DinD data always uses Docker named volumes (`<name>-docker`) regardless of storage mode — overlay2 requires a native filesystem and cannot run on bind-mounted host directories.

### Bind String Construction

| Resource | Volume mode | Directory mode |
|----------|------------|----------------|
| Data (mapper/traefik) | `<volumeName>:/data:ro` | `<hostPath>:/data:ro` |
| Worker workspace | `<name>-workspace:/workspace` | `<hostPath>/workspaces/<name>:/workspace` |
| Worker agents | `<name>-agents:/home/agent/.agent-data` | `<hostPath>/agents/<name>:/home/agent/.agent-data` |
| Worker DinD | `<name>-docker:/var/lib/docker` | `<name>-docker:/var/lib/docker` (always named volume) |
| Traefik certs | `agentor-traefik-certs:/letsencrypt` | `<hostPath>/traefik-certs:/letsencrypt` |

### Cleanup

| Operation | Volume mode | Directory mode |
|-----------|------------|----------------|
| Remove workspace | `docker volume rm <name>-workspace` | `rm -rf /data/workspaces/<name>/` |
| Remove agents | `docker volume rm <name>-agents` | `rm -rf /data/agents/<name>/` |
| Remove DinD | `docker volume rm <name>-docker` | `docker volume rm <name>-docker` (same) |

## Worker State & Persistence

Workers exist in four states:

| State | Container | Workspace + Agents + DinD | Port/Domain Mappings | WorkerStore |
|-------|-----------|---------------------------|----------------------|-------------|
| **running** | Running | Mounted | Active | `active` |
| **stopped** | Stopped | Mounted | Preserved (idle) | `active` |
| **archived** | Removed | Kept on disk | Preserved (idle) | `archived` |
| **deleted** | Removed | Removed | Removed | Removed |

Port and domain mappings are keyed by the stable worker name (not the Docker container ID), so they survive stop/restart, archive/unarchive, and rebuild. On rebuild and unarchive, the mapping's `workerId` field is automatically reassigned to the new container ID (`reassignWorkerMappings` in `services.ts`). The mapper and Traefik both route to the worker by name via Docker DNS — fresh lookups pick up the new container automatically, so no forced recreation is needed. Mappings are only removed on permanent delete (via `cleanupWorkerMappings` inside `ContainerManager.remove()` and `ContainerManager.deleteArchived()`).

### Workspace, Agents & DinD Storage

Each worker gets persistent storage mounted at `/workspace`, `/home/agent/.agent-data`, and (when DinD is enabled) `/var/lib/docker`. In **volume mode**, these are Docker named volumes (`${containerName}-workspace`, `${containerName}-agents`, `${containerName}-docker`). In **directory mode**, workspace and agents are host directories (`<dataDir>/workspaces/${containerName}/`, `<dataDir>/agents/${containerName}/`). All survive container stops, restarts, and archiving. On archive, only the container is removed — workspace, agents, and DinD data persist for unarchiving. On delete, all are removed.

The agents volume stores agent CLI configuration directories (`claude/`, `gemini/`, `codex/`, `shared/`, `claude.json`). The entrypoint symlinks these to their expected home directory paths (`~/.claude`, `~/.gemini`, `~/.codex`, `~/.agents`, `~/.claude.json`). This preserves MCP server configs, conversation history, auto-memory, installed plugins/extensions, custom commands, and other agent state across container lifecycle events. Credential files (OAuth tokens) are bind-mounted on top of the volume subdirectories — Docker processes the volume mount first, then overlays the individual file bind mounts.

### WorkerStore

`WorkerStore` (`orchestrator/server/utils/worker-store.ts`) persists all worker metadata to `${dataDir}/workers.json`. Keyed by container name (stable across archive/unarchive — the Docker container ID changes on unarchive). Extends `JsonStore<string, WorkerRecord>` (generic base class in `json-store.ts`).

On startup, `ContainerManager.reconcileWorkers()` syncs the WorkerStore with Docker state:
- Docker containers not in the store are registered (backward compat)
- Active workers whose containers are gone are marked archived

### Docker Labels

Docker labels remain the **runtime** source of truth for active containers. `ContainerManager.sync()` queries Docker and reconstructs state from labels. The WorkerStore is the **persistent** source of truth for archived workers (whose containers no longer exist).

**Docker labels stored on each worker** (`agentor.*`):
- `agentor.managed=true` — filter key for listing
- `agentor.created` — ISO timestamp
- `agentor.display-name` — optional friendly name
- `agentor.repos` — JSON-stringified array of repo configs

Configuration data (CPU limit, memory limit, network mode, Docker-in-Docker, environment ID/name) is persisted in WorkerStore (`workers.json`), not in Docker labels. The detail modal reads these fields from `ContainerInfo` (populated from WorkerStore during `sync()`). For backward compatibility, `sync()` falls back to reading legacy labels (`agentor.cpu-limit`, `agentor.memory-limit`, `agentor.network-mode`, `agentor.docker-enabled`, `agentor.environment-id`, `agentor.environment-name`) from containers created before this change.
