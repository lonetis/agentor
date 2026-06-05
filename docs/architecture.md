# Architecture

## Container Overview

```
Browser (Vue 3/Nuxt UI) <--HTTP/JSON--> Orchestrator (Nuxt 3/Nitro) <--dockerode exec--> Worker (tmux/agent)
Browser (xterm.js)       <--WebSocket--> Nitro (crossws)             <--docker stream--> Worker (tmux)
Browser (noVNC iframe)   <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (websockify <--> x11vnc <--> Xvfb)
Browser (code-server)    <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (code-server on port 8443)
Worker (curl)            <--HTTP/JSON--> Orchestrator /api/worker-self/* (no auth — calls identified by Docker source IP via requireWorkerSelf())
Orchestrator             <--docker exec-> apps/*/manage.sh (start/stop/list app instances in worker)
Orchestrator (TraefikManager) <--dockerode--> Traefik container (unified proxy: port mappings + domain routing, TLS)
```

Three managed containers:
- **Orchestrator**: Nuxt 3 app (SPA mode) with Nitro server, serving dashboard + managing workers and the Traefik container via Docker socket
- **Traefik**: Unified reverse proxy for both TCP port mappings (one dedicated entrypoint per mapping) and HTTP/HTTPS/TCP domain routing with Let's Encrypt TLS. Managed by the orchestrator — created when any port mapping, domain mapping, or dashboard subdomain is configured, removed when empty. Domain routing requires `BASE_DOMAINS`; port mappings work without it.
- **Workers**: Single unified Docker image (`agentor-worker`, Ubuntu 24.04) with all agent CLIs pre-installed, running in tmux, plus an integrated display stack (Xvfb + fluxbox + x11vnc + noVNC on port 6080), code-server (VS Code on port 8443), and Chromium. Each worker is a single container with all agents available.

## Worker Identity & Naming

Every worker has a consistent base resource shape — `id`, `createdAt`, `updatedAt`, plus the owning `userId` — and on top of that a Docker container id, a derived container name, and a user-facing label. Only the first group below is **persisted** in `workers.json`; the Docker-derived fields (`containerId`, `containerName`, `imageName`, `imageId`) are **discovered at runtime** and exist only on the merged `ContainerInfo` the API returns — never in the stored `WorkerRecord`:

- **`id`** *(persisted)* — an immutable UUID v4 minted server-side (`crypto.randomUUID`). Clients never send or choose it. It is the worker's stable internal identity: the WorkerStore key, the `agentor.id` label value, the basis for `containerName`, and the directory-mode storage leaf. It is **stable across rebuild and unarchive** (the worker keeps the same `id` even though the underlying container is destroyed and recreated). The API identifies workers by this `id` everywhere — `/api/containers/:id`, `/api/archived/:id`. There is no `name` field on a worker.
- **`displayName`** *(persisted)* — the editable, user-facing label shown in the dashboard. Free-form (spaces / mixed case allowed) and not required to be unique — two of a user's workers may share a displayName. The client supplies it on create (the server defaults it to a friendly generated slug when omitted), it is capped at 100 chars, and it is renameable post-creation via `PATCH /api/containers/:id` without recreating the container.
- **`containerId`** *(runtime, not persisted)* — the Docker container id assigned by Docker. Unlike `id`, this **changes on every rebuild/unarchive** because a fresh container is created. The orchestrator resolves the UUID `id` → current `containerId` from Docker (the container carrying `agentor.id=<id>`) when it needs to talk to Docker.
- **`containerName`** *(runtime, not persisted — recomputed as `agentor-worker-<id>`)* — the Docker container name. This is what Docker sees, what Traefik resolves via DNS, and what per-worker Docker volume names are prefixed with (`<containerName>-workspace`, `<containerName>-agents`, `<containerName>-docker`). Stable across the worker's whole lifecycle, so it is cheaply derived from `id` whenever needed (e.g. mapping reassignment, stale cleanup) rather than stored.
- **`imageName`** / **`imageId`** *(runtime, not persisted)* — the image reference the container runs and its resolved digest id, read straight from the Docker container during `sync()`.

No custom `Hostname` is set on the container, so Docker defaults it to the short container id (e.g. `16b082a7681b`) — the in-container `hostname` command and the shell prompt show that docker short id, not the worker UUID or any friendly label.

The stores key rows by the UUID `id`. Routing (Traefik service backends, log collector attachment, stale-worker cleanup, mapping reassignment on rebuild/unarchive) keys by `containerName` — stable across the worker's entire lifecycle.

Docker labels set on every worker container make sync from Docker → WorkerStore unambiguous and minimal:
- `agentor.managed=true` — filter key for listing
- `agentor.id=<worker uuid>` — resolves the container back to its `WorkerRecord` (which holds the owner `userId` and all config)

## Storage Modes

The orchestrator supports two storage modes, auto-detected from how `/data` is mounted:

| Mode | Mount type | Detection | Worker data storage |
|------|-----------|-----------|-------------------|
| **Volume** | `agentor-data:/data` | `Type: "volume"` | Docker named volumes (`<containerName>-workspace`, `<containerName>-agents`, `<containerName>-docker`, `agentor-traefik-certs`) |
| **Directory** | `./data:/data` | `Type: "bind"` | Per-user subdirectories under the data directory on the host |

Switch modes by changing one line in the compose file — no env vars needed. `StorageManager` (`orchestrator/server/utils/storage.ts`) self-inspects the orchestrator container on startup to determine the mount type. Traefik shares the data volume/directory read-only to pick up `traefik-config.yml` and self-signed certs.

### Directory Layout

```
/data/
├── auth.db                         ← better-auth SQLite DB
├── auth.secret                     ← BETTER_AUTH_SECRET (auto-generated if unset)
├── traefik-config.yml              ← dynamic Traefik config (written by orchestrator)
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
    ├── env-vars.json               ← this user's uniform key/value env var list ({ envVars: [{ key, value }] })
    ├── ssh/authorized_keys         ← this user's SSH public key (the key's only home — not an env var)
    ├── usage.json                  ← this user's polled agent usage state
    ├── credentials/
    │   ├── claude.json             ← bind-mounted into every worker this user owns
    │   ├── codex.json
    │   └── gemini.json
    ├── workspaces/<id>/            ← per-worker workspace (directory mode, keyed by the worker UUID)
    └── agents/<id>/                 ← per-worker agent config (`.claude`, `.gemini`, `.codex`, `.agents`, `.claude.json`)
```

Every user-scoped store writes to `users/<userId>/<file>.json`. Built-in, platform-seeded entries (default environment, built-in capabilities / instructions / init scripts) are re-seeded to `defaults/<file>.json` on every startup from `orchestrator/server/built-in/`. The source filename (without extension) is the entry's `name`; its `id` is a **stable UUID deterministically derived from that slug** (RFC 4122 v5, via `builtInId()` in `built-in-content.ts`) — constant across the every-startup re-seed, so stored references (a worker's `environmentId`, an environment's `enabledCapabilityIds`) survive. User customs carry the owner's `userId` and a random UUID id; built-ins carry `userId: null`. The public `list()` on each store merges both views.

DinD data always uses Docker named volumes (`<containerName>-docker`) regardless of storage mode — overlay2 requires a native filesystem and cannot run on a bind-mounted host directory.

### Bind String Construction

| Resource | Volume mode | Directory mode |
|----------|------------|----------------|
| Data (Traefik) | `<volumeName>:/data:ro` | `<hostPath>:/data:ro` |
| Worker workspace | `<containerName>-workspace:/workspace` | `<hostPath>/users/<userId>/workspaces/<id>:/workspace` |
| Worker agents | `<containerName>-agents:/home/agent/.agent-data` | `<hostPath>/users/<userId>/agents/<id>:/home/agent/.agent-data` |
| Worker per-user creds (×3) | `<dataHostPath>/users/<userId>/credentials/{claude,codex,gemini}.json:/home/agent/.agent-data/{.claude/.credentials.json,.codex/auth.json,.gemini/oauth_creds.json}` | same, with `<hostPath>` in front of `/users/...`. Directory mode pre-creates these mountpoints on the host so Docker Desktop's virtiofs accepts the nested file bind. |
| Worker DinD | `<containerName>-docker:/var/lib/docker` | `<containerName>-docker:/var/lib/docker` (always named volume) |
| Traefik certs | `agentor-traefik-certs:/letsencrypt` | `<hostPath>/traefik-certs:/letsencrypt` |

`<dataHostPath>` is resolved by `StorageManager` at startup via Docker self-inspection (in volume mode, Docker reports the volume's `_data` directory as the mount source). Only the worker owner's three credential files are bind-mounted into each container — different users' credentials are never visible to one another.

### Cleanup

| Operation | Volume mode | Directory mode |
|-----------|------------|----------------|
| Remove workspace | `docker volume rm <containerName>-workspace` | `rm -rf /data/users/<userId>/workspaces/<id>/` |
| Remove agents | `docker volume rm <containerName>-agents` | `rm -rf /data/users/<userId>/agents/<id>/` |
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

Each worker gets persistent storage mounted at `/workspace`, `/home/agent/.agent-data`, and (when DinD is enabled) `/var/lib/docker`. In **volume mode**, these are Docker named volumes (`<containerName>-workspace`, `<containerName>-agents`, `<containerName>-docker`). In **directory mode**, workspace and agents live under the owner's user directory keyed by the worker UUID (`<dataDir>/users/<userId>/workspaces/<id>/`, `<dataDir>/users/<userId>/agents/<id>/`). All survive container stops, restarts, and archiving. On archive, only the container is removed — workspace, agents, and DinD data persist for unarchiving. On permanent delete, all are removed.

The agents volume stores agent CLI configuration directories (`claude/`, `gemini/`, `codex/`, `agents/`, `claude.json`). The entrypoint symlinks these to their expected home directory paths (`~/.claude`, `~/.gemini`, `~/.codex`, `~/.agents`, `~/.claude.json`). This preserves MCP server configs, conversation history, auto-memory, installed plugins/extensions, custom commands, and other agent state across container lifecycle events. Credential files (OAuth tokens) are bind-mounted on top of the agents volume — Docker processes the volume mount first, then overlays the individual file bind mounts.

### WorkerStore

`WorkerStore` (`server/utils/worker-store.ts`) persists worker metadata per user at `<dataDir>/users/<userId>/workers.json`, keyed by the UUID `id`. Each `WorkerRecord` carries the standard base-resource fields (`id`, `userId`, `createdAt`, `updatedAt`) plus `displayName`, `status`, optional `archivedAt`, the config FKs/settings (`environmentId`, `repos`, `mounts`, `initScript`), and `pendingRebuild`. It deliberately does **not** persist any Docker-derived field (`containerId`, `containerName`, `imageName`, `imageId`) — those are discovered at runtime. Extends `UserScopedJsonStore<string, WorkerRecord>` (`server/utils/user-scoped-store.ts`) which scans `users/*/workers.json` on init and maintains a `Map<userId, Map<id, WorkerRecord>>` internally. `list()` returns a flat view across all users (sorted by `id`); `listForUser(userId)` scopes to one user; `findById(id)` resolves a single worker. The editable `displayName` is the only field a rename touches — `id`, the derived container name, volumes, and mappings are unaffected.

On startup, `ContainerManager.reconcileWorkers()` syncs the WorkerStore with Docker state:
- Docker containers carrying `agentor.id` are matched back to their `WorkerRecord` via `WorkerStore.findById` (the record holds the owner `userId` and all config); the live container's id/name/image are merged onto the runtime `ContainerInfo`, never written back to the record
- Active workers whose containers are gone (matched by the derived `agentor-worker-<id>` name) are marked archived

### Docker Labels

Docker labels remain the **runtime** source of truth for active containers. `ContainerManager.sync()` queries Docker, reads each container's `agentor.id` label, and looks up the authoritative `WorkerRecord` in the store (owner + config live there, not on the container). The WorkerStore is the **persistent** source of truth for archived workers (whose containers no longer exist).

**Docker labels stored on each worker** (deliberately minimal):
- `agentor.managed=true` — filter key for listing
- `agentor.id=<worker uuid>` — resolves the container to its `WorkerRecord`

The old `agentor.user-id` and `agentor.worker-name` labels are gone — the owner `userId` and the worker's own config live in `WorkerRecord` on disk, keyed by `agentor.id`.

The `WorkerRecord` is **normalized** in two ways. First, it stores only the worker's own settings (`displayName`, `repos`, `mounts`, `initScript`) plus foreign-key references — `userId` (owner) and `environmentId` (assigned environment); the environment's config (CPU/memory limits, network mode, Docker-in-Docker, setup script, env vars, exposed APIs, capabilities, instructions) is **resolved live from the `EnvironmentStore` by `environmentId`** when the container is built — never copied onto the worker, and likewise the git identity (name/email) is **resolved live from the owning `userId`** at build time, not snapshotted. Second, it stores nothing the Docker API already knows — `containerId`, `containerName`, `imageName`, and `imageId` are **discovered at runtime** in `ContainerManager.sync()` by matching the `agentor.id` label (the container name is just recomputed as `agentor-worker-<id>`). This means editing an environment (or a user's profile) is automatically picked up on the next rebuild, a rebuilt container's new id/image are reflected with no write to the record, and there is exactly one source of truth for each piece of config.
