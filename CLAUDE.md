# Agent Orchestrator (Agentor)

Docker orchestrator that spawns isolated AI coding agent workers, each in its own container with terminal access via a web dashboard. All agent CLIs (Claude, Codex, Gemini) are pre-installed in a single unified worker image. Includes a modular app system (Chromium, SOCKS5 proxy), a dynamic port mapper, domain mapping via Traefik, a VS Code editor (code-server), VS Code tunnel (native VS Code client connections), and an automatic update mechanism for production deployments.

## Architecture

```
Browser (Vue 3/Nuxt UI) <--HTTP/JSON--> Orchestrator (Nuxt 3/Nitro) <--dockerode exec--> Worker (tmux/agent)
Browser (xterm.js)       <--WebSocket--> Nitro (crossws)             <--docker stream--> Worker (tmux)
Browser (noVNC iframe)   <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (websockify <--> x11vnc <--> Xvfb)
Browser (code-server)    <--HTTP/WS----> Nitro (proxy)               <--HTTP/WS-------> Worker (code-server on port 8443)
Local VS Code            <--tunnel-----> Microsoft Relay              <--tunnel--------> Worker (code tunnel)
Orchestrator             <--docker exec-> apps/*/manage.sh (start/stop/list/status app instances in worker)
Orchestrator (MapperManager)  <--dockerode--> Mapper container (TCP proxies to worker internal ports)
Orchestrator (TraefikManager) <--dockerode--> Traefik container (domain-based reverse proxy, TLS)
```

Four managed containers:
- **Orchestrator**: Nuxt 3 app (SPA mode) with Nitro server, serving dashboard + managing workers, mapper, and Traefik containers via Docker socket
- **Mapper**: Lightweight Node.js container running TCP reverse proxies. Managed by the orchestrator via dockerode — created/recreated when port mappings change, removed when empty.
- **Traefik**: Reverse proxy for domain-based routing with Let's Encrypt TLS. Managed by the orchestrator — created when domain mappings or dashboard subdomain are configured, removed when empty. Optional (requires `BASE_DOMAINS` env var).
- **Workers**: Single unified Docker image (`agentor-worker`, Ubuntu 24.04) with all agent CLIs pre-installed, running in tmux, plus an integrated display stack (Xvfb + fluxbox + x11vnc + noVNC on port 6080), code-server (VS Code on port 8443), VS Code tunnel (native VS Code client via Microsoft relay), and Chromium. Each worker is a single container with all agents available. Three persistent volumes per worker: workspace (`/workspace`), agent config data (`/home/agent/.agent-data` — symlinked to `~/.claude`, `~/.gemini`, `~/.codex`, `~/.agents`, `~/.claude.json`), and optionally DinD (`/var/lib/docker`).

## Detailed Documentation

| Topic | File | Contents |
|-------|------|----------|
| Architecture | @docs/architecture.md | Storage modes (volume vs directory), worker state & persistence, WorkerStore, Docker labels |
| Worker System | @docs/worker.md | Unified worker image, init scripts, agents, git identity wrapper, DinD, host bind mounts, startup sequence |
| Networking | @docs/networking.md | Port mapper, domain mapping (Traefik), TLS challenges, self-signed certs, config drift detection |
| UI | @docs/ui.md | Split pane layout, tmux tab integration, theme system, VS Code editor, UI state persistence |
| Environments | @docs/environments.md | Environment system, network firewall, capabilities, instructions, worker API exposure |
| Logging | @docs/logging.md | Centralized logging, log collection, rotation, WebSocket streaming, log pane UI |
| Production | @docs/production.md | Update mechanism, agent usage monitoring |
| Apps | @docs/apps.md | Modular app system, adding new apps |
| API | @docs/api.md | API documentation (OpenAPI), adding docs to routes |
| Key Files | @docs/key-files.md | Complete file listing (server, client, worker, tests) |
| Testing | @docs/testing.md | Running tests, writing tests, conventions, maintaining FEATURES.md and TESTS.md |
| Authentication | @docs/authentication.md | better-auth integration, users, roles, resource ownership |
| Feature Inventory | @tests/FEATURES.md | Canonical list of all user-facing features, drives test coverage |
| Test Suite Index | @tests/TESTS.md | Test counts, structure, and design decisions |

## Tech Stack

- Framework: Nuxt 3 (SPA mode), Nitro server, Vue 3
- UI: Nuxt UI v3, Tailwind CSS v4
- Terminal: xterm.js 5 (@xterm/xterm + @xterm/addon-fit)
- Auth: better-auth 1.6 + admin plugin (user management, RBAC), better-sqlite3 (SQLite database for users/sessions)
- Backend: dockerode 4, nanoid 5, crossws (WebSocket, bundled with Nitro), ws (WebSocket client for noVNC proxy), tar-stream (archive packing)
- Workers: Ubuntu 24.04, agent CLI (varies), tmux, git, Docker CE (opt-in DinD), Xvfb, fluxbox, x11vnc, noVNC (port 6080), code-server (port 8443), VS Code CLI (tunnel), Chromium, microsocks, dnsmasq, ipset, iptables

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

## Testing

```bash
# Integration tests (requires running orchestrator at localhost:3000)
cd tests && npm test            # All tests (API + UI)
cd tests && npm run test:api    # API only (headless, fast)
cd tests && npm run test:ui     # UI only (Chromium)
cd tests && npm run test:headed # UI with visible browser
cd tests && npx playwright test api/health.spec.ts  # Single file

# Testing workflow: run the full suite once, save output, then fix individual files
cd tests && npm test 2>&1 | tee /tmp/test-results.txt  # Full run, save output
cd tests && npx playwright test ui/container-card.spec.ts  # Re-run single file
```

**Dockerized tests** (recommended — runs against a fresh isolated agentor stack so the developer's local instance on `localhost:3000` is never touched):

```bash
cd tests && npm run test:docker                              # All tests
cd tests && npm run test:docker:api                          # API only
cd tests && npm run test:docker:ui                           # UI only
cd tests && npm run test:docker -- api/health.spec.ts        # Single file (note the `--`)
cd tests && npm run test:docker -- --project=api -g "health" # Pass-through any playwright flags
cd tests && npm run test:docker:clean                        # Wipe cached dockerd volume
```

The runner is a single privileged container (`docker-compose.tests.yml`) that starts its own `dockerd` (DinD), builds the agentor images, boots a fresh stack on `https://dash.docker.localhost` (Traefik with self-signed certs on `docker.localhost` + `docker2.localhost`), runs playwright, and tears the stack down on exit. No host ports are exposed, so it coexists with a local agentor on `localhost:3000`. The persistent `agentor-test-runner-docker` volume caches the inner dockerd between runs (subsequent runs skip image builds); `test:docker:clean` wipes it for a fully cold rebuild. Triple-nested DinD (host → worker → test-runner → inner orchestrator → inner workers) works because every level uses `overlay2` on a volume.

**Approach**: Do not repeatedly run the entire test suite. Run it once, save the output, then re-run only the individual failing test files to iterate on fixes.

**Requirements**:
- Every new feature or behavior change **must** include tests. Add API tests (`tests/api/`) for new endpoints and UI tests (`tests/ui/`) for new UI interactions. Follow existing patterns in the test suite.
- Always **run the affected tests** after adding or modifying them (`cd tests && npx playwright test <file>`) to verify they pass before committing.
- Always **update `tests/FEATURES.md`** whenever a feature is added, changed, or removed. This is the canonical feature inventory that drives test coverage — keep it in sync with the actual product.
- Always **update `tests/TESTS.md`** whenever tests are added, removed, or changed. Update the per-file test counts, file totals, and overview numbers to stay accurate.

See @docs/testing.md for full details (writing tests, conventions, helpers, debugging).

## Gotchas

- **crossws `peer.ctx` is undefined** in Nitro's bundled crossws — store per-connection state in a `Map<string, Context>` keyed by `peer.id`, not on `peer.ctx`
- **crossws `close` event does not fire reliably** in Nitro's dev mode — detect disconnected peers via `peer.send()` failure in the data handler instead of relying on the `close` callback
- **Iframes and xterm steal mouse events** during split pane / tab drag — apply `pointer-events: none` via a body class (`body.tab-dragging iframe, body.tab-dragging .xterm`)
- **`<ClientOnly>` is unnecessary** in SPA mode (`ssr: false`) and can cause layout issues — all code already runs client-only
- **Claude Code CLI exits immediately** (code 0) under QEMU emulation (amd64 on ARM host) — always build the worker image for native arch, never use `--platform=linux/amd64`
- **Regenerate `package-lock.json`** after modifying `package.json` dependencies (`rm package-lock.json && npm install`) or `npm ci` in the Dockerfile will fail
- **`useEventListener` is VueUse**, not a Nuxt built-in — use manual `addEventListener`/`removeEventListener` in lifecycle hooks
- **Reka UI tooltip hover in tests** — `locator.hover()` does not reliably trigger Reka UI tooltips; use `page.mouse.move(x, y)` with exact bounding box coordinates instead. Also `getByRole('tooltip', { name })` fails to match accessible names — check `[role="tooltip"]` text content directly
- **Nuxt 4 compatibility mode** (`future.compatibilityVersion: 4`) makes `app/` the source root — pages, components, composables, and assets go under `app/`, not the project root
- **Nitro `[...path]` catch-all doesn't match empty path** — `/editor/{id}/` needs a separate `index.ts` handler; the catch-all only matches when there's at least one path segment
- **tmux `respawn-pane -k` without explicit command** re-runs the original pane start command — always pass `bash` (or the desired command) as the last argument
- **h3 combined HTTP+WS handlers** — use `defineEventHandler({ handler, websocket })` when both HTTP and WebSocket must be served on the same route (e.g., code-server proxy)

## Environment Variables

See @.env.example for full list. Agent API keys (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) are optional — for OAuth/subscription auth, log in once inside any worker instead (see @.cred.example/README). Claude also supports `CLAUDE_CODE_OAUTH_TOKEN` (1-year setup token, generated via `claude setup-token`).
