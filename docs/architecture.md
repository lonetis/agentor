# Architecture

## Container Overview

```
Browser (Vue 3/Nuxt UI) <--HTTP/JSON--> Orchestrator (Nuxt 3/Nitro) <--dockerode exec--> Worker (tmux/agent)
Browser (xterm.js)       <--WebSocket--> Nitro (crossws)             <--docker stream--> Worker (tmux)
Browser (noVNC iframe)   <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (websockify <--> x11vnc <--> Xvfb)
Browser (code-server)    <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (code-server on port 8443)
Orchestrator             <--docker exec-> apps/*/manage.sh (start/stop/list app instances in worker)
Orchestrator (TraefikManager) <--dockerode--> Traefik container (unified proxy: port mappings + domain routing, TLS)
```

Three managed containers:
- **Orchestrator**: Nuxt 3 app (SPA mode) with Nitro server, serving dashboard + managing workers and the Traefik container via Docker socket
- **Traefik**: Unified reverse proxy for both TCP port mappings (one dedicated entrypoint per mapping) and HTTP/HTTPS/TCP domain routing with Let's Encrypt TLS. Managed by the orchestrator — created when any port mapping, domain mapping, or dashboard subdomain is configured, removed when empty. Domain routing requires `BASE_DOMAINS`; port mappings work without it.
- **Workers**: Single unified Docker image (`agentor-worker`, Ubuntu 24.04) with all agent CLIs pre-installed, running in tmux, plus an integrated display stack (Xvfb + fluxbox + x11vnc + noVNC on port 6080), code-server (VS Code on port 8443), and Chromium. Each worker is a single container with all agents available.

## Worker Identity & Naming

Every worker has two names:

- **`name`** — per-user short name (e.g. `happy-panda`), picked by the user or auto-generated. Two different users can each have a worker named `happy-panda` without collision; uniqueness is enforced per user.
- **`containerName`** — globally unique Docker container name, derived as `<containerPrefix>-<userId>-<name>`. This is what Docker sees, what Traefik resolves via DNS, and what per-worker Docker volume names are prefixed with (`<containerName>-workspace`, `<containerName>-agents`, `<containerName>-docker`).

The UI and per-user stores key rows by `name` (scoped to a user). Routing (Traefik service backends, log collector attachment, stale-worker cleanup, mapping reassignment on rebuild/unarchive) keys by `containerName` — stable across the worker's entire lifecycle.

Docker labels set on every worker container make sync from Docker → WorkerStore unambiguous:
- `agentor.managed=true` — filter key for listing
- `agentor.user-id=<userId>` — owner
- `agentor.worker-name=<name>` — per-user short name

## Storage Modes

The orchestrator supports two storage modes, auto-detected from how `/data` is mounted:

| Mode | Mount type | Detection | Worker data storage |
|------|-----------|-----------|-------------------|
| **Volume** | `agentor-data:/data` | `Type: "volume"` | Docker named volumes (`<containerName>-workspace`, `<containerName>-agents`, `<containerName>-docker`, `agentor-traefik-certs`) |
| **Directory** | `./data:/data` | `Type: "bind"` | Per-user subdirectories under the data directory on the host |

Switch modes by changing one line in the compose file — no env vars needed. `StorageManager` (`orchestrator/server/utils/storage.ts`) self-inspects the orchestrator container on startup to determine the mount type. Traefik shares the data volume/directory read-only to pick up `traefik-config.json` and self-signed certs.

### Directory Layout

```
/data/
├── auth.db                         ← better-auth SQLite DB
├── auth.secret                     ← BETTER_AUTH_SECRET (auto-generated if unset)
├── traefik-config.json             ← dynamic Traefik config (written by orchestrator)
├── logs/                           ← orchestrator + worker + traefik logs (NDJSON + rotations)
├── traefik-certs/                  ← ACME / self-signed cert storage
│   └── acme.json
├── selfsigned-certs/               ← self-signed CA + per-domain wildcards
├── defaults/                       ← built-in, platform-seeded resources (re-seeded on startup)
│   ├── environments.json
│   ├── capabilities.json
│   ├── instructions.json
│   └── init-scripts.json
└── users/<userId>/
    ├── workers.json                ← this user's workers (active + archived)
    ├── port-mappings.json          ← this user's port mappings
    ├── domain-mappings.json        ← this user's domain mappings
    ├── environments.json           ← this user's custom environments
    ├── capabilities.json           ← this user's custom capabilities
    ├── instructions.json           ← this user's custom instructions
    ├── init-scripts.json           ← this user's custom init scripts
    ├── env-vars.json               ← this user's API keys + custom env vars
    ├── usage.json                  ← this user's polled agent usage state
    ├── credentials/
    │   ├── claude.json             ← bind-mounted into every worker this user owns
    │   ├── codex.json
    │   └── gemini.json
    ├── workspaces/<name>/          ← per-worker workspace (directory mode)
    └── agents/<name>/               ← per-worker agent config (`.claude`, `.gemini`, `.codex`, `.agents`, `.claude.json`)
```

Every user-scoped store writes to `users/<userId>/<file>.json`. Built-in, platform-seeded entries (default environment, built-in capabilities / instructions / init scripts) are re-seeded to `defaults/<file>.json` on every startup from `orchestrator/server/built-in/`. User customs carry the owner's `userId`; built-ins carry `userId: null`. The public `list()` on each store merges both views.

DinD data always uses Docker named volumes (`<containerName>-docker`) regardless of storage mode — overlay2 requires a native filesystem and cannot run on a bind-mounted host directory.

### Bind String Construction

| Resource | Volume mode | Directory mode |
|----------|------------|----------------|
| Data (Traefik) | `<volumeName>:/data:ro` | `<hostPath>:/data:ro` |
| Worker workspace | `<containerName>-workspace:/workspace` | `<hostPath>/users/<userId>/workspaces/<name>:/workspace` |
| Worker agents | `<containerName>-agents:/home/agent/.agent-data` | `<hostPath>/users/<userId>/agents/<name>:/home/agent/.agent-data` |
| Worker per-user creds (×3) | `<dataHostPath>/users/<userId>/credentials/{claude,codex,gemini}.json:/home/agent/.agent-data/{.claude/.credentials.json,.codex/auth.json,.gemini/oauth_creds.json}` | same, with `<hostPath>` in front of `/users/...`. Directory mode pre-creates these mountpoints on the host so Docker Desktop's virtiofs accepts the nested file bind. |
| Worker DinD | `<containerName>-docker:/var/lib/docker` | `<containerName>-docker:/var/lib/docker` (always named volume) |
| Traefik certs | `agentor-traefik-certs:/letsencrypt` | `<hostPath>/traefik-certs:/letsencrypt` |

`<dataHostPath>` is resolved by `StorageManager` at startup via Docker self-inspection (in volume mode, Docker reports the volume's `_data` directory as the mount source). Only the worker owner's three credential files are bind-mounted into each container — different users' credentials are never visible to one another.

### Cleanup

| Operation | Volume mode | Directory mode |
|-----------|------------|----------------|
| Remove workspace | `docker volume rm <containerName>-workspace` | `rm -rf /data/users/<userId>/workspaces/<name>/` |
| Remove agents | `docker volume rm <containerName>-agents` | `rm -rf /data/users/<userId>/agents/<name>/` |
| Remove DinD | `docker volume rm <containerName>-docker` | `docker volume rm <containerName>-docker` (same) |
| Remove user data (on user delete) | `rm -rf /data/users/<userId>/` | same |

When a user is deleted from the auth DB, the orphan sweeper (`server/utils/orphan-sweeper.ts`) prunes every user-scoped store's in-memory cache and recursively removes `/data/users/<userId>/` — taking workspaces, agent dirs, credentials, and every per-user JSON file with it in one shot. It runs at startup and every 10 minutes.

## Worker State & Persistence

Workers exist in four states:

| State | Container | Workspace + Agents + DinD | Port/Domain Mappings | WorkerStore |
|-------|-----------|---------------------------|----------------------|-------------|
| **running** | Running | Mounted | Active | `active` |
| **stopped** | Stopped | Mounted | Preserved (idle) | `active` |
| **archived** | Removed | Kept on disk | Preserved (idle) | `archived` |
| **deleted** | Removed | Removed | Removed | Removed |

Port and domain mappings are keyed by the stable `containerName`, so they survive stop/restart, archive/unarchive, and rebuild. Traefik routes to the worker by DNS name — fresh lookups pick up the new container automatically after rebuild/unarchive with no forced recreation needed. Mappings are only removed on permanent delete (via `cleanupWorkerMappings` inside `ContainerManager.remove()` and `ContainerManager.deleteArchived()`).

### Workspace, Agents & DinD Storage

Each worker gets persistent storage mounted at `/workspace`, `/home/agent/.agent-data`, and (when DinD is enabled) `/var/lib/docker`. In **volume mode**, these are Docker named volumes (`<containerName>-workspace`, `<containerName>-agents`, `<containerName>-docker`). In **directory mode**, workspace and agents live under the owner's user directory (`<dataDir>/users/<userId>/workspaces/<name>/`, `<dataDir>/users/<userId>/agents/<name>/`). All survive container stops, restarts, and archiving. On archive, only the container is removed — workspace, agents, and DinD data persist for unarchiving. On permanent delete, all are removed.

The agents volume stores agent CLI configuration directories (`claude/`, `gemini/`, `codex/`, `agents/`, `claude.json`). The entrypoint symlinks these to their expected home directory paths (`~/.claude`, `~/.gemini`, `~/.codex`, `~/.agents`, `~/.claude.json`). This preserves MCP server configs, conversation history, auto-memory, installed plugins/extensions, custom commands, and other agent state across container lifecycle events. Credential files (OAuth tokens) are bind-mounted on top of the agents volume — Docker processes the volume mount first, then overlays the individual file bind mounts.

### WorkerStore

`WorkerStore` (`server/utils/worker-store.ts`) persists worker metadata per user at `<dataDir>/users/<userId>/workers.json`, keyed by the user-facing `name`. Extends `UserScopedJsonStore<string, WorkerRecord>` (`server/utils/user-scoped-store.ts`) which scans `users/*/workers.json` on init and maintains a `Map<userId, Map<name, WorkerRecord>>` internally. `list()` returns a flat view across all users (sorted by `containerName`); `listForUser(userId)` scopes to one user.

On startup, `ContainerManager.reconcileWorkers()` syncs the WorkerStore with Docker state:
- Docker containers not in the store are registered (using `agentor.user-id` and `agentor.worker-name` labels to identify owner + name)
- Active workers whose containers are gone are marked archived

### Docker Labels

Docker labels remain the **runtime** source of truth for active containers. `ContainerManager.sync()` queries Docker and reconstructs `(userId, name)` pairs from labels, then looks up the authoritative `WorkerRecord` in the store. The WorkerStore is the **persistent** source of truth for archived workers (whose containers no longer exist).

**Docker labels stored on each worker**:
- `agentor.managed=true` — filter key for listing
- `agentor.user-id=<userId>` — owner
- `agentor.worker-name=<name>` — per-user short name

Configuration data (CPU limit, memory limit, network mode, Docker-in-Docker, environment ID/name, repos, mounts, git identity) lives in `WorkerRecord` on disk — never in Docker labels.
