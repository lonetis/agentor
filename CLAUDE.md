# Agent Orchestrator (Agentor)

Docker orchestrator that spawns isolated AI coding agent workers, each in its own container with terminal access via a web dashboard. All agent CLIs (Claude, Codex, Gemini) are pre-installed in a single unified worker image. Includes a modular app system (Chromium, SOCKS5 proxy), a dynamic port mapper, domain mapping via Traefik, a VS Code editor (code-server), and an automatic update mechanism for production deployments.

## Architecture

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
- **Traefik**: Reverse proxy for domain-based routing with Let's Encrypt TLS. Managed by the orchestrator — created when domain mappings or dashboard subdomain are configured, removed when empty. Optional (requires `BASE_DOMAIN` env var).
- **Workers**: Single unified Docker image (`agentor-worker`, Ubuntu 24.04) with all agent CLIs pre-installed, running in tmux, plus an integrated display stack (Xvfb + fluxbox + x11vnc + noVNC on port 6080), code-server (VS Code on port 8443), and Chromium. Each worker is a single container with all agents available.

## Worker State & Persistence

Workers exist in four states:

| State | Container | Workspace Volume | WorkerStore |
|-------|-----------|-----------------|-------------|
| **running** | Running | Mounted | `active` |
| **stopped** | Stopped | Mounted | `active` |
| **archived** | Removed | Kept on disk | `archived` |
| **deleted** | Removed | Removed | Removed |

### Workspace Volumes

Each worker gets a persistent **named Docker volume** (`${containerName}-workspace`) mounted at `/workspace`. This volume survives container stops, restarts, and archiving. The same pattern as DinD volumes (`${containerName}-docker`). On container removal (delete), the workspace volume is also removed. On archive, only the container is removed — the workspace volume persists.

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
- `agentor.cpu-limit` — CPU core limit
- `agentor.memory-limit` — memory limit string
- `agentor.network-mode` — firewall mode (omitted if `full`)
- `agentor.docker-enabled` — Docker-in-Docker flag
- `agentor.environment-id` — source environment ID
- `agentor.environment-name` — source environment name

The detail modal auto-displays all `agentor.*` labels (except internal ones like `managed`), so adding a new label to container creation automatically surfaces it in the UI.

## Unified Worker Image

A single Docker image (`agentor-worker`, built from `worker/`) contains all agent CLIs and their setup scripts. OAuth/subscription credentials are stored as JSON files in `.cred/` on the host and bind-mounted directly into worker containers at the correct paths (e.g., `.cred/claude.json` → `/home/agent/.claude/.credentials.json`). This means token rotations propagate to all workers instantly, and logging in manually inside one worker authenticates all future (and existing) workers. API keys (always-valid, no rotation) remain in `.env`. On container startup, ALL agent setup scripts run to configure settings for every installed agent. Users start agents via init script presets or manually in the terminal.

### Init Preset System

Init presets are defined in `orchestrator/server/utils/init-presets.ts` via `INIT_PRESETS`. Each preset specifies:
- Display name and start script (e.g., `#!/bin/bash\nclaude --dangerously-skip-permissions`)
- API domains (always allowed through the firewall in restricted modes)
- Environment variable mappings for auth tokens

The UI provides a dropdown to select a preset, which populates an editable init script textarea. Users can modify the script or write fully custom ones. The dropdown syncs both ways — editing the textarea to match a preset selects it, clearing it switches to None, and any other edit switches to Custom.

**Adding a new agent** requires:
1. Install the CLI in `worker/Dockerfile`
2. Create `worker/agents/<agent-id>/setup.sh` (settings/config, runs on every container start)
3. Create `worker/agents/<agent-id>/git-identity` (two lines: name, email — used by the git wrapper)
4. Add an init preset entry in `orchestrator/server/utils/init-presets.ts`
5. Add a credential mapping in `orchestrator/server/utils/credential-mounts.ts` (`AGENT_CREDENTIAL_MAPPINGS`)
6. Add a template file in `.cred.example/` and document in `.cred.example/README`
7. Rebuild the worker image

### Worker image contents

The unified worker image (`worker/`) provides:
- Ubuntu 24.04, Node.js 22 LTS, git, tmux, curl, build-essential, python3, ripgrep, fd-find, jq, sudo, locale
- Display stack: Xvfb, fluxbox, x11vnc, noVNC/websockify (port 6080)
- Code editor: code-server (VS Code in browser, port 8443)
- Browsers: Chromium (from Debian bookworm repo), Playwright (with bundled Chromium + Firefox)
- microsocks (SOCKS5 proxy)
- Editors: neovim, vim, nano
- Utilities: htop, btop, tree, less, openssh-client, rsync, strace, dnsutils, net-tools, iputils-ping, file, man-db
- Network firewall: dnsmasq, ipset, iptables (for environment network policies)
- App management scripts in `/home/agent/apps/` (chromium/manage.sh, socks5/manage.sh)
- Shared `agent` user (uid 1000) with passwordless sudo
- Common entrypoint: tmux session, agent setups, docker daemon, display stack, code-server, git auth, repo clone, network firewall, setup/init scripts, launch

### Pre-installed agents:
- **Claude**: Anthropic Claude Code CLI (`worker/agents/claude/`)
- **Codex**: OpenAI Codex CLI (`worker/agents/codex/`)
- **Gemini**: Google Gemini CLI (`worker/agents/gemini/`)

### Git Identity Wrapper

A process-tree-aware git wrapper (`worker/git-wrapper.sh`, installed at `/usr/local/bin/git`) shadows `/usr/bin/git`. On every `git` call, it walks the `/proc` process tree to detect which agent binary is an ancestor. When a match is found, it reads the identity from `worker/agents/<agent>/git-identity` (two-line file: name, email) and sets `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` before exec-ing the real git. This ensures commits are attributed to the correct agent regardless of which one is running, even when multiple agents are used in different tmux tabs within the same worker. Manual `git` usage (no agent ancestor) falls back to global git config.

## Git Provider System

Git providers are defined in `orchestrator/server/utils/git-providers.ts` via `GIT_PROVIDER_REGISTRY`. Each provider specifies:
- Display metadata (name, URL placeholder)
- Token config key and env var name
- Clone domains (injected into restricted firewall modes so `git clone` works)

**Adding a new git provider** requires:
1. Add a registry entry in `orchestrator/server/utils/git-providers.ts`
2. Add the token config key to `orchestrator/server/utils/config.ts` (`Config` interface + `loadConfig`)
3. Add an auth block and clone case in `worker/entrypoint.sh`
4. Add the token env var to `.env.example`

The orchestrator automatically passes configured tokens to workers and the UI shows a provider selector per-repo.

### Current providers:
- **github**: GitHub (via `gh` CLI for auth + clone)

## Modular App System

Apps run inside worker containers and are managed via `orchestrator/server/utils/apps.ts` (`APP_REGISTRY`). Each app type has a manage script in `worker/apps/` and internal port ranges.

**Adding a new app** requires only:
1. Add a registry entry in `orchestrator/server/utils/apps.ts`
2. Create `worker/apps/<app>/manage.sh` (start/stop/list pattern)
3. Install the app binary in `worker/Dockerfile`

### Current apps:
- **chromium**: Chromium with CDP (ports 9222-9322)
- **socks5**: microsocks SOCKS5 proxy (ports 1080-1180)

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

Domain-based routing via a Traefik reverse proxy container. Optional — requires `BASE_DOMAIN` env var. All subdomains of the base domain route to worker containers. Supports HTTP, HTTPS, and TCP protocols with Let's Encrypt TLS certificates and optional HTTP basic auth per mapping.

**Architecture:**
- `DomainMappingStore` (`domain-mapping-store.ts`): Persists mappings to `<DATA_DIR>/domain-mappings.json`, extends `JsonStore<string, DomainMapping>`
- `TraefikManager` (`traefik-manager.ts`): Manages the `agentor-traefik` container lifecycle. On mapping changes, writes a Traefik file provider config (`traefik-config.json`), then ensures the Traefik container exists. Uses `providers.file.watch=true` so config changes are picked up without container restart. Serialized via promise queue.
- Traefik container: publishes ports 80 (HTTP → HTTPS redirect) and 443 (TLS termination), uses Let's Encrypt ACME HTTP challenge
- Dashboard subdomain: if `DASHBOARD_SUBDOMAIN` is set, the orchestrator dashboard is accessible at `<DASHBOARD_SUBDOMAIN>.<BASE_DOMAIN>`

**Container lifecycle:**
- Created when mappings exist or dashboard subdomain is configured, removed when both are empty
- Config-only updates (no container restart needed) — Traefik file provider watches for changes
- Labeled `agentor.managed=traefik`
- Shares the data volume read-only (`DATA_VOLUME:/data:ro`) for reading `traefik-config.json`
- Uses a separate named volume (`agentor-traefik-certs`) for Let's Encrypt certificate storage
- Connected to `agentor-net` for Docker DNS resolution of worker container names

**Basic auth:** SHA1 htpasswd format generated in `traefik-manager.ts` using Node.js `crypto.createHash('sha1')`. Applied as Traefik middleware per-mapping. The dashboard subdomain also supports basic auth via `DASHBOARD_AUTH_USER` and `DASHBOARD_AUTH_PASSWORD` env vars (both required to enable).

## VS Code Editor (code-server)

Browser-based VS Code editor integrated into each worker container via [code-server](https://github.com/coder/code-server). Runs on port 8443 with no authentication (`--auth none`), accessible through the orchestrator's HTTP/WebSocket proxy.

**Architecture:**
- `ServicePane.vue`: unified iframe-based pane for both desktop (noVNC) and editor (code-server), parameterized by endpoint, label, icon, and URL
- `useContainerServiceStatus.ts`: polls service status endpoint for a container
- `editor/[containerId]/index.ts`: Combined HTTP+WS handler for bare editor path (h3 `defineEventHandler({ handler, websocket })`)
- `editor/[containerId]/[...path].ts`: Combined HTTP+WS handler for sub-paths (same pattern, strips `/editor/{id}` prefix for WS relay)
- Worker entrypoint starts code-server in Phase 3b (after display stack, before git auth)
- Default workspace folder: `/workspace`

## Production Update Mechanism

Automatic image update detection and per-image or bulk updates for production deployments. Active when `WORKER_IMAGE_PREFIX` is set (GHCR images) and/or `BASE_DOMAIN` is set (Traefik). Tracks four images: orchestrator, mapper, worker (GHCR), and traefik (Docker Hub).

**Architecture:**
- `UpdateChecker` (`update-checker.ts`): Registry-agnostic digest checker. Parses image references (`parseImageRef`) to handle GHCR (`ghcr.io/org/repo:tag`), Docker Hub user images (`user/repo:tag`), and official images (`traefik:v3` → `library/traefik`). Token acquisition (`getRegistryToken`) handles GHCR (Basic auth + Bearer) and Docker Hub (anonymous token) separately. Polls every 5 minutes.
- `UpdateNotification.vue`: Sidebar component showing per-image status with individual "Update" buttons and a bulk "Update All" button
- `useUpdates.ts`: composable for update status polling (60s), `applyUpdates()` for bulk, `applyImage(key)` for per-image updates

**Update flow:**
1. Mapper/worker: pull new image → recreate mapper container (via `MapperManager.forceRecreate()`) → workers use new image on next create
2. Traefik: pull new image → recreate Traefik container (via `TraefikManager.forceRecreate()`) → TLS certs persist on named volume
3. Orchestrator: pull new image → create replacement container with temp name (`-next`) → spawn a one-shot swapper container (`-swapper`, `AutoRemove: true`) that uses the Docker socket to stop→remove→rename→start the replacement → UI polls `/api/health` until server returns. The swapper is needed because stopping the orchestrator's own container kills the Node.js process, so the remaining steps (remove, create, start) can't run in-process.

**Per-image updates:** The apply endpoint accepts an optional `{ images: UpdatableImage[] }` body to pull only specific images. The `UpdatableImage` type (`'orchestrator' | 'mapper' | 'worker' | 'traefik'`) is defined in `shared/types.ts`.

**No version numbers** — only image digest hashes (sha256) are compared and displayed. Workers are NOT automatically restarted; they pick up the new image when next created or unarchived.

## Docker-in-Docker (DinD)

Workers support running Docker inside the container, enabled per-environment via the `dockerEnabled` toggle. When enabled:

- The worker container runs in **privileged mode** (`--privileged`)
- A **named Docker volume** (`<container-name>-docker`) is mounted at `/var/lib/docker` (overlay2 cannot nest on the container's overlayfs root, but works on a volume backed by the host filesystem)
- **dockerd** starts before the display stack with the **overlay2** storage driver
- The `agent` user is in the `docker` group — no `sudo` needed for `docker` commands
- Docker Compose, BuildKit, and all standard Docker features work natively
- Docker data (pulled images, built images, containers) **persists across container restarts** via the volume
- The volume is automatically cleaned up when the worker container is removed

**Architecture:**
- Orchestrator mounts a named volume `<container-name>-docker` at `/var/lib/docker` and passes `DOCKER_ENABLED=true` env var
- Entrypoint cleans stale PID files/sockets, writes `/etc/docker/daemon.json`, starts `sudo dockerd` in background
- Waits up to 30s for `/var/run/docker.sock` to appear
- Inner Docker uses its own bridge network (`172.17.0.0/16`), which is allowed by the existing firewall rules
- On container removal, orchestrator also removes the `-docker` volume

## Host Bind Mounts

Workers support optional host bind-mounts configured at creation time. Each mount specifies a `source` (host path), `target` (container path), and `readOnly` flag. Defined via the `MountConfig` interface in `orchestrator/app/types/index.ts`, configured in the UI via `MountInput.vue` within `CreateContainerModal.vue`, and passed through `ContainerManager.createContainer()` to dockerode as Docker bind mounts.

## Environment System

Environments bundle per-worker configuration: CPU/memory limits, network access policy, Docker-in-Docker toggle, custom env vars, setup script (pre-agent), and init script (agent launch script via preset or custom). Managed via `orchestrator/server/utils/environments.ts` (`EnvironmentStore`), stored as JSON in `<DATA_DIR>/environments.json`.

### Network Firewall

Uses **dnsmasq + ipset + iptables** for network-level domain filtering (not a bypassable proxy):

| Mode | Behavior |
|------|----------|
| `full` | No restrictions (default, backward compatible) |
| `block` | iptables OUTPUT DROP — only agent API domains allowed |
| `block-all` | iptables OUTPUT DROP — all outbound blocked, no exceptions |
| `package-managers` | dnsmasq + ipset allowlist of 98 package registry domains + agent API domains |
| `custom` | dnsmasq + ipset with user-defined domains (+ optional PM domains) + agent API domains |

**Agent API domains** (aggregated from all init presets in `INIT_PRESETS`) are always injected into every restricted mode so any agent CLI can reach its model API, auth, and telemetry endpoints. The UI shows all agent domains in a collapsible section when a restricted mode is selected.

Architecture: dnsmasq resolves allowed domains and adds IPs to a kernel ipset via `ipset=` directives. iptables OUTPUT policy is DROP, with exceptions for loopback, Docker networks, and the ipset. Blocks all protocols (TCP/UDP/ICMP) to non-allowed destinations.

### Startup Sequence (entrypoint.sh)

Fully synchronous — every phase runs foreground and completes before the next begins. The tmux pane runs an animated loading screen (`loading-screen.sh`) that renders at ~12fps with braille spinner animation, per-step timing, and a colored progress bar. The entrypoint writes events to `/tmp/worker-events` (append-only log: `STEP_ID|STATUS|LABEL[|ELAPSED_MS]`), and the loading screen re-parses and redraws every frame. Millisecond-precision timing logs (`[+Nms]`) are also emitted to stdout via `/proc/uptime`.

0. **Tmux session** with animated loading screen (`bash /home/agent/loading-screen.sh`)
1. **Agent setup** — all `agents/*/setup.sh` scripts (CLI config, settings — OAuth credentials are bind-mounted)
2. **Docker daemon** — if `DOCKER_ENABLED=true`: start dockerd, wait for socket (up to 30s); otherwise skipped
3. **Display stack** — Xvfb + fluxbox + x11vnc + websockify/noVNC, wait for each service
4. **Code editor** — code-server on port 8443 (`--auth none --bind-addr 0.0.0.0:8443`), wait for port ready
5. **Git authentication** — if `GITHUB_TOKEN`: `gh auth login` + `gh auth setup-git`; otherwise skipped
6. **Repository clone** — if `REPOS`: parallel clone per repo, wait for all; otherwise skipped
7. **Network firewall** — dnsmasq + ipset + iptables (runs after all network ops complete); skipped for `full` mode
8. **User setup script** — `SETUP_SCRIPT_B64`, runs under firewall
9. **Launch** — `tmux respawn-pane -k` replaces loading screen; init script runs as the pane command (`bash $INIT_FILE`), not via `send-keys`. When the agent exits, `remain-on-exit` + `pane-died` hook respawn a clean shell.

## Tmux Tab Integration

Web-native tab bar inside the terminal pane — each tab represents a tmux window in the container's tmux session. Replaces manual tmux keyboard shortcuts with clickable tabs.

**Architecture** (`TerminalPane.vue` + `useTmuxTabs` + `TmuxTabBar`):
- `useTmuxTabs(containerId)` manages the tmux window list: fetches via API, polls every 3s for external changes (e.g. agent creating windows), provides create/close/activate/rename
- `TerminalPane` maintains a `Map<windowName, useTerminal()>` — one terminal per tmux window, all with live WebSocket connections
- `v-show` toggles visibility (not `v-if`) so hidden terminals keep their DOM, scrollback buffer, and WebSocket stream
- `TmuxTabBar` renders the inner tab bar (30px, dark theme, visually subordinate to the outer pane tab bar)
- Active window persisted per container in a module-level `Map` — survives outer tab close/reopen
- The main "shell" window cannot be closed or renamed — close button hidden, rename disabled
- New tab name input next to "+" button — type a name before creating, or leave empty for auto-generated `shell-{4char}`
- Click an already-active tab to inline-rename it (input replaces label, Enter to confirm, Escape to cancel)
- 10k scrollback per terminal, Alt+scroll for fast scrolling

## Split Pane UI

VS Code-style editor groups with recursive splits. Tabs can be dragged to any edge (left/right/top/bottom) to create horizontal or vertical splits, or to the center to merge into an existing group.

**Data model** (`useSplitPanes` composable, singleton module state):
- `rootNode: PaneNode | null` — recursive tree where each node is either a **leaf** (has `tabs[]`, `activeTabId`, `sizeFraction`) or a **container** (has `direction: 'horizontal'|'vertical'`, `children: PaneNode[]`, `sizeFraction`)
- `focusedNodeId` — which leaf receives new tabs from sidebar actions
- Type guards: `isLeaf(node)` / `isContainer(node)` — exported from composable
- Tree operations: splitting a leaf wraps it in a container; closing all tabs in a leaf collapses single-child containers recursively; same-direction splits insert as siblings (avoids unnecessary nesting)
- Public API: `rootNode`, `focusedNodeId`, `tabs`, `activeTabId`, `openTab`, `closeTab`, `closeTabsForContainer`, `focusGroup`, `moveTab`, `splitWithTab`, `resizeNodes`, `activateTab`

**Layout** (`SplitPaneLayout.vue` + `PaneSplitNode.vue`):
- `SplitPaneLayout` is a thin wrapper that renders a single `PaneSplitNode` rooted at `rootNode`
- `PaneSplitNode` is a recursive component: leaf nodes render `PaneGroupTabBar` + `PaneContent` + `PaneDropOverlay`; container nodes render `flex-row` (horizontal) or `flex-col` (vertical) with recursive children + `PaneSeparator` between them
- `PaneSeparator` accepts a `direction` prop — horizontal mode uses `cursor: col-resize`, vertical mode uses `cursor: row-resize`
- `PaneDropOverlay` uses 5-zone nearest-edge detection (left/right/top/bottom at 25% threshold, center otherwise)

**Drag-and-drop** (`useDragTab` composable):
- HTML5 DnD API (`draggable`, `dragstart`, `dragover`, `drop`, `dragend`)
- `body.tab-dragging` class disables pointer events on iframes/xterm during drag
- `body.split-dragging` (horizontal) and `body.split-dragging-v` (vertical) during separator resize
- Drop zones: edge 25% → split in that direction, center → merge into leaf

**Terminal resize**: `ResizeObserver` on the terminal container element handles all resize scenarios (window resize, sidebar drag, pane separator drag) — no manual callback propagation needed.

## Theme System

Three-way color mode toggle (Default/White/Dark) in the sidebar header, powered by `@nuxtjs/color-mode` (bundled with Nuxt UI v3). Default preference is `dark` (preserves the original dark-only UI). Persisted to `localStorage` automatically.

| Mode | Behavior |
|------|----------|
| **Default** | Follows OS preference (`prefers-color-scheme`) |
| **White** | Forces light mode |
| **Dark** | Forces dark mode |

**Architecture:**
- `ThemeToggle.vue` — segmented icon button group (monitor/sun/moon) that sets `useColorMode().preference`
- Tailwind `dark:` variants on all custom classes (e.g., `bg-gray-50 dark:bg-gray-900`)
- CSS custom properties in `main.css` for hex-color scoped styles: pane tab bar (`--pane-tab-*`), terminal area (`--terminal-*`), scrollbar (`--scrollbar-*`)
- Nuxt UI components (UButton, UModal, UInput, etc.) handle dark mode natively
- xterm.js theme defined as `DARK_THEME` / `LIGHT_THEME` constants in `useTerminal.ts`, reactively switched via `watch(colorMode.value)`
- TmuxTabBar scoped CSS uses `--terminal-*` CSS variables for seamless theme transitions

## Tech Stack

- Framework: Nuxt 3 (SPA mode), Nitro server, Vue 3
- UI: Nuxt UI v3, Tailwind CSS v4
- Terminal: xterm.js 5 (@xterm/xterm + @xterm/addon-fit)
- Backend: dockerode 4, nanoid 5, crossws (WebSocket, bundled with Nitro), ws (WebSocket client for noVNC proxy), tar-stream (archive packing)
- Workers: Ubuntu 24.04, agent CLI (varies), tmux, git, Docker CE (opt-in DinD), Xvfb, fluxbox, x11vnc, noVNC (port 6080), code-server (port 8443), Chromium, microsocks, dnsmasq, ipset, iptables

## Key Files

### Root
- `.env.example` - All environment variables with descriptions and defaults
- `.cred.example/` - Template credential files for OAuth/subscription auth (claude.json, codex.json, gemini.json, README)
- `docker-compose.prod.yml` - Production Docker Compose configuration (GHCR images)
- `docker-compose.dev.yml` - Development Docker Compose (hot reload via mounted source)
- `.github/workflows/docker-build.yml` - CI: multi-arch image builds for all components

### Mapper
- `mapper/Dockerfile` - Minimal Node.js Alpine image for the port mapper container
- `mapper/proxy.mjs` - Standalone TCP proxy script (reads /data/port-mappings.json)

### Orchestrator — Config
- `orchestrator/app.config.ts` - App-level configuration

### Orchestrator — Shared
- `orchestrator/shared/types.ts` - Shared TypeScript interfaces used by both server and client (RepoConfig, MountConfig, TmuxWindow, AppInstanceInfo, NetworkMode, ServiceStatus, ContainerInfo, ContainerStatus, CreateContainerRequest, ImageUpdateInfo, UpdateStatus, ApplyResult)

### Orchestrator — Server
- `orchestrator/Dockerfile` - Multi-stage Node 22 Alpine build
- `orchestrator/nuxt.config.ts` - Nuxt configuration (modules, SPA mode, Nitro WebSocket)
- `orchestrator/server/plugins/services.ts` - Nitro startup: init Docker + ContainerManager + PortMappingStore + MapperManager + DomainMappingStore + TraefikManager + EnvironmentStore + WorkerStore + UpdateChecker
- `orchestrator/server/utils/config.ts` - Environment variable parsing
- `orchestrator/server/utils/init-presets.ts` - Init preset registry (INIT_PRESETS) for agent start scripts and API domains
- `orchestrator/server/utils/git-providers.ts` - Git provider registry (GIT_PROVIDER_REGISTRY)
- `orchestrator/server/utils/apps.ts` - App type registry (APP_REGISTRY)
- `orchestrator/server/utils/json-store.ts` - Generic JsonStore<K, V> base class (Map + JSON file + saveQueue pattern)
- `orchestrator/server/utils/docker.ts` - DockerService class (dockerode wrapper)
- `orchestrator/server/utils/container.ts` - ContainerManager class (container lifecycle, archive/unarchive)
- `orchestrator/server/utils/port-mapping-store.ts` - PortMappingStore class (extends JsonStore)
- `orchestrator/server/utils/mapper-manager.ts` - MapperManager class (mapper container lifecycle via dockerode)
- `orchestrator/server/utils/domain-mapping-store.ts` - DomainMappingStore class (persistent domain mappings)
- `orchestrator/server/utils/traefik-manager.ts` - TraefikManager class (Traefik container lifecycle, dynamic config generation)
- `orchestrator/server/utils/update-checker.ts` - UpdateChecker class (GHCR digest polling, image pull, orchestrator self-replacement)
- `orchestrator/server/utils/environments.ts` - EnvironmentStore class, network mode types, package manager domains list
- `orchestrator/server/utils/worker-store.ts` - WorkerStore class (persistent worker metadata for archive/unarchive)
- `orchestrator/server/utils/credential-mounts.ts` - CredentialMountManager class (resolves host path of /cred mount, generates bind mount strings for worker containers) + AGENT_CREDENTIAL_MAPPINGS registry
- `orchestrator/server/utils/services.ts` - Singleton getters via `singleton()` factory (useDockerService, useContainerManager, useConfig, usePortMappingStore, useMapperManager, useDomainMappingStore, useTraefikManager, useGitHubService, useEnvironmentStore, useWorkerStore, useUpdateChecker, useCredentialMountManager) + shared `cleanupWorkerMappings()` utility
- `orchestrator/server/utils/validation.ts` - Shared validation constants (WINDOW_NAME_RE)
- `orchestrator/server/utils/ws-utils.ts` - Shared WebSocket utilities (getPeerId, toBuffer, createWsRelayHandlers factory for desktop/editor relays)
- `orchestrator/server/utils/terminal-handler.ts` - Docker stream WebSocket terminal logic (uses ws-utils, exports terminalWsHandler)
- `orchestrator/server/utils/github.ts` - GitHubService class (GitHub API wrapper, repo/branch operations)
- `orchestrator/server/api/` - REST API routes (file-based, JSON only)
- `orchestrator/server/routes/desktop/` - HTTP reverse proxy for noVNC static files (per-container)
- `orchestrator/server/routes/editor/` - Combined HTTP+WS proxy for code-server (per-container, h3 combined handler + ws-utils relay)
- `orchestrator/server/routes/ws/desktop/` - WebSocket relay for VNC protocol (per-container, crossws + ws)
- `orchestrator/server/routes/ws/terminal/` - WebSocket terminal routes (crossws)

### Orchestrator — Client (app/)
- `orchestrator/app/assets/css/main.css` - CSS custom properties for theming (--pane-tab-*, --terminal-*, --scrollbar-*) + dark/light mode overrides
- `orchestrator/app/app.vue` - Nuxt app root component
- `orchestrator/app/pages/index.vue` - Dashboard page (sidebar + split pane layout + modals)
- `orchestrator/app/plugins/xterm.client.ts` - Provides `$Terminal` and `$FitAddon` globally (avoids SSR import issues)
- `orchestrator/app/components/AppSidebar.vue` - Left sidebar (container list, archived workers, port mappings, domain mappings, update notification)
- `orchestrator/app/components/AppInstanceRow.vue` - Single app row in AppsPane
- `orchestrator/app/components/AppsPane.vue` - App instances for a container
- `orchestrator/app/components/ArchivedWorkerCard.vue` - Archived worker card in sidebar
- `orchestrator/app/components/ContainerCard.vue` - Worker card (controls, upload/download, archive, detail modal)
- `orchestrator/app/components/ContainerDetailModal.vue` - Detail modal (auto-displays all `agentor.*` Docker labels)
- `orchestrator/app/components/CreateContainerModal.vue` - New worker modal (environment selector, init preset, repos)
- `orchestrator/app/components/ServicePane.vue` - Unified iframe pane for desktop (noVNC) and editor (code-server)
- `orchestrator/app/components/DomainMappingsPanel.vue` - Domain mapping CRUD panel (subdomain, protocol, basic auth)
- `orchestrator/app/components/EnvironmentEditor.vue` - Environment form (resources, network, Docker, scripts)
- `orchestrator/app/components/EnvironmentsModal.vue` - Environment list + editor (CRUD)
- `orchestrator/app/components/FileDropZone.vue` - Drag-and-drop file zone for uploads
- `orchestrator/app/components/MountInput.vue` - Form input for a single host bind-mount config
- `orchestrator/app/components/PaneContent.vue` - Renders active tab content (Terminal/Desktop/Editor/Apps/Placeholder)
- `orchestrator/app/components/PaneDropOverlay.vue` - 5-zone drop overlay during tab drag (left/right/top/bottom/center)
- `orchestrator/app/components/PaneGroupTabBar.vue` - Per-leaf tab bar (HTML5 draggable tabs, drop target)
- `orchestrator/app/components/PaneSeparator.vue` - Resizable separator between pane nodes (horizontal or vertical)
- `orchestrator/app/components/PaneSplitNode.vue` - Recursive component rendering PaneNode tree (leaf → tab bar + content, container → flex children + separators)
- `orchestrator/app/components/PortMappingsPanel.vue` - Port mappings management
- `orchestrator/app/components/RepoInput.vue` - Repo URL + branch + provider input with GitHub repo/branch search
- `orchestrator/app/components/SplitPaneLayout.vue` - Thin wrapper rendering PaneSplitNode at rootNode
- `orchestrator/app/components/TerminalPane.vue` - Multi-terminal host with inner tmux tab bar (TmuxTabBar)
- `orchestrator/app/components/TerminalPlaceholder.vue` - Empty state when no worker is open
- `orchestrator/app/components/ThemeToggle.vue` - Three-way color mode toggle (Default/White/Dark)
- `orchestrator/app/components/TmuxTabBar.vue` - Inner tmux window tab bar
- `orchestrator/app/components/UpdateNotification.vue` - Sidebar update notification (image digests, one-click update)
- `orchestrator/app/components/UploadModal.vue` - Modal for workspace file uploads
- `orchestrator/app/composables/useApps.ts` - App CRUD + polling
- `orchestrator/app/composables/useArchivedWorkers.ts` - Archived workers list + polling
- `orchestrator/app/composables/useContainers.ts` - Container CRUD + polling
- `orchestrator/app/composables/useContainerServiceStatus.ts` - Service status polling (5s) for desktop/editor
- `orchestrator/app/composables/useDomainMappings.ts` - Domain mapping CRUD + polling
- `orchestrator/app/composables/useInitPresetSync.ts` - Bidirectional sync between init preset dropdown and init script textarea
- `orchestrator/app/composables/useDragTab.ts` - Tab drag-and-drop (HTML5 DnD)
- `orchestrator/app/composables/useEnvironments.ts` - Environment CRUD
- `orchestrator/app/composables/useGitHubRepos.ts` - GitHub repos list, org filter, create repo
- `orchestrator/app/composables/useGitProviders.ts` - Git provider list
- `orchestrator/app/composables/useInitPresets.ts` - Init preset list
- `orchestrator/app/composables/usePolling.ts` - Polling lifecycle helper (start/stop with onMounted/onUnmounted)
- `orchestrator/app/composables/usePortMappings.ts` - Port mapping CRUD + polling
- `orchestrator/app/composables/useSidebarResize.ts` - Sidebar drag-to-resize
- `orchestrator/app/composables/useSplitPanes.ts` - Pane state manager (tab CRUD, split/merge, resize)
- `orchestrator/app/composables/useTerminal.ts` - xterm.js lifecycle + WebSocket (manually managed with `destroy()`)
- `orchestrator/app/composables/useTmuxTabs.ts` - Tmux window management (fetch, poll, create, close, activate, rename)
- `orchestrator/app/composables/useUpdates.ts` - Update status polling + apply (production mode only)
- `orchestrator/app/types/index.ts` - Client-side TypeScript types: re-exports shared types + defines GitProviderInfo, GitHubRepoInfo, GitHubBranchInfo, InitPresetInfo, AppTypeInfo, PortMapping, DomainMapping, DomainMapperStatus, EnvironmentInfo, OrchestratorEnvVar, ArchivedWorker, TabType, Tab, SplitDirection, PaneLeafNode, PaneContainerNode, PaneNode, DragPayload, DropZone

### Worker
- `worker/Dockerfile` - Unified worker image (Node.js 22, all agent CLIs, code-server, display stack, Chromium, Playwright, Firefox, microsocks, utility packages, agent user, entrypoint)
- `worker/entrypoint.sh` - Entrypoint (tmux, agent setups, docker daemon, display stack, code-server, git auth, repo clone, firewall, setup script, launch)
- `worker/loading-screen.sh` - Animated startup display (braille spinner, progress bar, per-step timing)
- `worker/git-wrapper.sh` - Process-tree-aware git identity wrapper (installed at /usr/local/bin/git)
- `worker/apps/chromium/manage.sh` - Chromium app manager (start/stop/list via docker exec)
- `worker/apps/socks5/manage.sh` - SOCKS5 proxy app manager
- `worker/agents/claude/setup.sh` - Claude auth + config
- `worker/agents/codex/setup.sh` - Codex auth + config
- `worker/agents/gemini/setup.sh` - Gemini auth + config
- `worker/agents/*/git-identity` - Per-agent git identity (two lines: name, email)

## Gotchas

- **crossws `peer.ctx` is undefined** in Nitro's bundled crossws — store per-connection state in a `Map<string, Context>` keyed by `peer.id`, not on `peer.ctx`
- **Iframes and xterm steal mouse events** during split pane / tab drag — apply `pointer-events: none` via a body class (`body.tab-dragging iframe, body.tab-dragging .xterm`)
- **`<ClientOnly>` is unnecessary** in SPA mode (`ssr: false`) and can cause layout issues — all code already runs client-only
- **Claude Code CLI exits immediately** (code 0) under QEMU emulation (amd64 on ARM host) — always build the worker image for native arch, never use `--platform=linux/amd64`
- **Regenerate `package-lock.json`** after modifying `package.json` dependencies (`rm package-lock.json && npm install`) or `npm ci` in the Dockerfile will fail
- **`useEventListener` is VueUse**, not a Nuxt built-in — use manual `addEventListener`/`removeEventListener` in lifecycle hooks
- **Nuxt 4 compatibility mode** (`future.compatibilityVersion: 4`) makes `app/` the source root — pages, components, composables, and assets go under `app/`, not the project root
- **Nitro `[...path]` catch-all doesn't match empty path** — `/editor/{id}/` needs a separate `index.ts` handler; the catch-all only matches when there's at least one path segment
- **tmux `respawn-pane -k` without explicit command** re-runs the original pane start command — always pass `bash` (or the desired command) as the last argument
- **h3 combined HTTP+WS handlers** — use `defineEventHandler({ handler, websocket })` when both HTTP and WebSocket must be served on the same route (e.g., code-server proxy)

## Dev Commands

The orchestrator always runs inside Docker (both dev and production).

```bash
# Build mapper and worker images locally
docker build -t agentor-mapper:latest ./mapper
docker build -t agentor-worker:latest ./worker

# Development (hot reload via mounted source)
docker compose -f docker-compose.dev.yml up

# Production (uses GHCR images via WORKER_IMAGE_PREFIX)
docker compose -f docker-compose.prod.yml up -d

# Build orchestrator image locally
cd orchestrator && docker build -t agentor-orchestrator:latest .

# Typecheck (run from orchestrator/)
cd orchestrator && npx nuxi prepare && npx vue-tsc --noEmit -p .nuxt/tsconfig.json
```

## API Endpoints

All API routes return JSON only (no HTML partials).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/init-presets` | List available init script presets |
| GET | `/api/git-providers` | List available git providers |
| GET | `/api/app-types` | List available app types |
| GET | `/api/package-manager-domains` | List active package manager domains |
| GET | `/api/containers` | List all worker containers |
| GET | `/api/containers/generate-name` | Generate a random container name |
| POST | `/api/containers` | Create new worker (accepts `environmentId`, `initScript`) |
| POST | `/api/containers/:id/stop` | Stop worker |
| POST | `/api/containers/:id/restart` | Restart worker |
| DELETE | `/api/containers/:id` | Remove worker (deletes workspace) |
| POST | `/api/containers/:id/archive` | Archive worker (keeps workspace) |
| GET | `/api/containers/:id/workspace` | Download workspace as `.tar.gz` |
| POST | `/api/containers/:id/workspace` | Upload files to workspace (multipart) |
| GET | `/api/containers/:id/logs` | View container logs |
| GET | `/api/containers/:id/panes` | List tmux windows |
| POST | `/api/containers/:id/panes` | Create new tmux window (optional `name` in body) |
| PUT | `/api/containers/:id/panes/:windowName` | Rename tmux window (`newName` in body) |
| DELETE | `/api/containers/:id/panes/:windowName` | Kill tmux window |
| GET | `/api/containers/:id/desktop/status` | Desktop status |
| GET | `/api/containers/:id/editor/status` | Editor (code-server) status |
| GET | `/api/containers/:id/apps` | List all running apps |
| GET | `/api/containers/:id/apps/:appType` | List running apps of specific type |
| POST | `/api/containers/:id/apps/:appType` | Start new app |
| DELETE | `/api/containers/:id/apps/:appType/:instanceId` | Stop app |
| GET | `/api/port-mappings` | List active port mappings |
| POST | `/api/port-mappings` | Create port mapping |
| DELETE | `/api/port-mappings/:port` | Remove port mapping |
| GET | `/api/port-mapper/status` | Mapping counts by type |
| GET | `/api/domain-mappings` | List domain mappings |
| POST | `/api/domain-mappings` | Create domain mapping |
| DELETE | `/api/domain-mappings/:id` | Remove domain mapping |
| GET | `/api/domain-mapper/status` | Domain mapper status (enabled, baseDomain) |
| GET | `/api/updates` | Update status (image digests, production mode) |
| POST | `/api/updates/check` | Trigger manual update check |
| POST | `/api/updates/apply` | Pull updated images, recreate mapper/orchestrator |
| GET | `/desktop/:containerId/**` | Reverse proxy to worker's noVNC (port 6080) |
| GET | `/editor/:containerId/**` | Reverse proxy to worker's code-server (port 8443) |
| WS | `/ws/desktop/:containerId` | WebSocket relay to worker's websockify (VNC) |
| WS | `/editor/:containerId/**` | WebSocket relay to worker's code-server (inline on same route) |
| WS | `/ws/terminal/:containerId` | Terminal WebSocket (agent default window) |
| WS | `/ws/terminal/:containerId/:windowName` | Terminal WebSocket (named window) |
| GET | `/api/environments` | List all environments |
| POST | `/api/environments` | Create environment |
| GET | `/api/environments/:id` | Get single environment |
| PUT | `/api/environments/:id` | Update environment |
| DELETE | `/api/environments/:id` | Delete environment |
| GET | `/api/archived` | List archived workers |
| POST | `/api/archived/:name/unarchive` | Unarchive worker |
| DELETE | `/api/archived/:name` | Permanently delete archived worker |
| GET | `/api/orchestrator-env-vars` | System env vars (all agents) |
| GET | `/api/github/repos` | List authenticated user's GitHub repos |
| POST | `/api/github/repos` | Create a new GitHub repository |
| GET | `/api/github/repos/:owner/:repo/branches` | List branches + default branch |
| GET | `/api/health` | Health check |

## Environment Variables

See `.env.example` for full list. Agent API keys (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) are optional — authentication can be configured manually inside the container. OAuth/subscription credentials are stored as JSON files in `.cred/` (see `.cred.example/README`).
