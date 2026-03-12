# Worker System

## Unified Worker Image

A single Docker image (`agentor-worker`, built from `worker/`) contains all agent CLIs and their setup scripts. OAuth/subscription credentials are stored as JSON files in `.cred/` on the host and bind-mounted directly into worker containers at the correct paths (e.g., `.cred/claude.json` → `/home/agent/.claude/.credentials.json`). All workers share the same credential files, so users only need to log in once inside any worker after installation — the credentials are written back automatically and propagate to all workers. Copying OAuth tokens from a local machine is not supported because refresh token rotation would cause the local and worker tokens to go out of sync. API keys (always-valid, no rotation) remain in `.env`. On container startup, ALL agent setup scripts run to configure settings for every installed agent. Users start agents via init script presets or manually in the terminal.

**Structured JSON env vars** — the orchestrator passes 4 JSON env vars to workers instead of 20+ individual variables:
- `ENVIRONMENT` — network mode, allowed domains, dockerEnabled, setupScript, envVars, exposeApis
- `SKILLS` — array of `{ name, content }` entries
- `AGENTS_MD` — array of `{ name, content }` entries
- `WORKER` — name, displayName, repos, initScript

Individual env vars that CLIs read directly remain as-is: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, `ORCHESTRATOR_URL`, `WORKER_CONTAINER_NAME`.

### Worker Image Contents

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
- Helper scripts: `memfd-exec.py` (memfd script executor), `setup.sh` (setup script runner), `init.sh` (init script runner)
- Common entrypoint: tmux session, env var export, agent setups (+ platform files), docker daemon, display stack, code-server, git auth, repo clone, network firewall, setup script (memfd), init script (memfd), launch

### Pre-installed Agents

- **Claude**: Anthropic Claude Code CLI (`worker/agents/claude/`)
- **Codex**: OpenAI Codex CLI (`worker/agents/codex/`)
- **Gemini**: Google Gemini CLI (`worker/agents/gemini/`)

### Adding a New Agent

1. Install the CLI in `worker/Dockerfile`
2. Create `worker/agents/<agent-id>/setup.sh` (auth/settings + skills/AGENTS.md writing — reads from `SKILLS` and `AGENTS_MD` JSON env vars)
3. Create `worker/agents/<agent-id>/git-identity` (two lines: name, email — used by the git wrapper)
4. Add an agent config entry in `orchestrator/server/utils/agent-config.ts` (API domains, env vars)
5. Add a built-in init script file in `orchestrator/server/built-in/init-scripts/`
6. Add a credential mapping in `orchestrator/server/utils/credential-mounts.ts` (`AGENT_CREDENTIAL_MAPPINGS`)
7. Add a template file in `.cred.example/` and document in `.cred.example/README`
8. Rebuild the worker image

No entrypoint changes needed — agent setup scripts handle all agent-specific logic (auth, settings, skills, AGENTS.md).

## Init Script System

Init scripts are managed via `InitScriptStore` (`orchestrator/server/utils/init-script-store.ts`), stored as JSON in `<DATA_DIR>/init-scripts.json`. Built-in init script files live in `orchestrator/server/built-in/init-scripts/` as plain `.sh` files — the filename (without extension) is both the ID and the name. Custom scripts can be created via the Init Scripts modal in the sidebar. Init scripts are just bash scripts — they are not tied to any specific agent.

Agent-specific configuration (API domains, env var mappings) lives separately in `orchestrator/server/utils/agent-config.ts` as a static registry (`AGENT_CONFIGS`). This provides `getAllAgentApiDomains()` (firewall allowlist) and `getAllAgentEnvVars(config)` (env vars for worker containers).

The UI provides a dropdown to select a script, which populates an editable init script textarea. Users can modify the script or write fully custom ones. The dropdown syncs both ways — editing the textarea to match a script selects it, clearing it switches to None, and any other edit switches to Custom. A "Manage" button opens the Init Scripts modal for CRUD operations.

**Built-in init scripts (3):**
- `claude` — Claude Code CLI with `--dangerously-skip-permissions`
- `codex` — OpenAI Codex CLI with `--dangerously-bypass-approvals-and-sandbox`
- `gemini` — Google Gemini CLI with `--yolo`

## Git Provider System

Git providers are defined in `orchestrator/server/utils/git-providers.ts` via `GIT_PROVIDER_REGISTRY`. Each provider specifies:
- Display metadata (name, URL placeholder)
- Token config key and env var name
- Clone domains (injected into restricted firewall modes so `git clone` works)

**Adding a new git provider:**
1. Add a registry entry in `orchestrator/server/utils/git-providers.ts`
2. Add the token config key to `orchestrator/server/utils/config.ts` (`Config` interface + `loadConfig`)
3. Add an auth block and clone case in `worker/entrypoint.sh`
4. Add the token env var to `.env.example`

The orchestrator automatically passes configured tokens to workers and the UI shows a provider selector per-repo.

**Current providers:** GitHub (via `gh` CLI for auth + clone)

## Git Identity Wrapper

A process-tree-aware git wrapper (`worker/git-wrapper.sh`, installed at `/usr/local/bin/git`) shadows `/usr/bin/git`. On every `git` call, it walks the `/proc` process tree to detect which agent binary is an ancestor. When a match is found, it reads the identity from `worker/agents/<agent>/git-identity` (two-line file: name, email) and sets `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` before exec-ing the real git. This ensures commits are attributed to the correct agent regardless of which one is running, even when multiple agents are used in different tmux tabs within the same worker. Manual `git` usage (no agent ancestor) falls back to global git config.

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
- Orchestrator mounts a named volume `<container-name>-docker` at `/var/lib/docker` and sets `dockerEnabled: true` in the `ENVIRONMENT` JSON env var
- Entrypoint reads `ENVIRONMENT.dockerEnabled` via jq, cleans stale PID files/sockets, writes `/etc/docker/daemon.json`, starts `sudo dockerd` in background
- Waits up to 30s for `/var/run/docker.sock` to appear
- Inner Docker uses its own bridge network (`172.17.0.0/16`), which is allowed by the existing firewall rules
- On container removal, orchestrator also removes the `-docker` volume

## Host Bind Mounts

Workers support optional host bind-mounts configured at creation time. Each mount specifies a `source` (host path), `target` (container path), and `readOnly` flag. Defined via the `MountConfig` interface in `orchestrator/app/types/index.ts`, configured in the UI via `MountInput.vue` within `CreateContainerModal.vue`, and passed through `ContainerManager.createContainer()` to dockerode as Docker bind mounts.

## Startup Sequence (entrypoint.sh)

Fully synchronous — every phase runs foreground and completes before the next begins. The tmux pane runs an animated loading screen (`loading-screen.sh`) that renders at ~12fps with braille spinner animation, per-step timing, and a colored progress bar. The entrypoint writes events to `/tmp/worker-events` (append-only log: `STEP_ID|STATUS|LABEL[|ELAPSED_MS]`), and the loading screen re-parses and redraws every frame. Millisecond-precision timing logs (`[+Nms]`) are also emitted to stdout via `/proc/uptime`.

0. **Tmux session** with animated loading screen (`bash /home/agent/loading-screen.sh`)
0b. **Export env vars** — `EXPOSE_*` flags from `ENVIRONMENT.exposeApis`, custom env vars from `ENVIRONMENT.envVars` (exported + set in tmux environment)
1. **Agent setup** — all `agents/*/setup.sh` scripts (CLI config, settings, skills + AGENTS.md on first startup — OAuth credentials are bind-mounted). Sentinel file touched after all scripts complete.
2. **Docker daemon** — if `ENVIRONMENT.dockerEnabled`: start dockerd, wait for socket (up to 30s); otherwise skipped
3. **Display stack** — Xvfb + fluxbox + x11vnc + websockify/noVNC, wait for each service
3b. **Code editor** — code-server on port 8443 (`--auth none --bind-addr 0.0.0.0:8443`), wait for port ready
4. **Git authentication** — if `GITHUB_TOKEN`: `gh auth login` + `gh auth setup-git`; otherwise skipped
5. **Repository clone** — if `WORKER.repos`: parallel clone per repo, wait for all; otherwise skipped
6. **Network firewall** — reads `ENVIRONMENT.networkMode` + `.allowedDomains` via jq; dnsmasq + ipset + iptables; skipped for `full` mode
7. **User setup script** — runs `/home/agent/setup.sh` which reads `ENVIRONMENT.setupScript` and executes via memfd (no temp files)
8. **Launch** — `tmux respawn-pane -k` replaces loading screen; `/home/agent/init.sh` reads `WORKER.initScript` and executes via memfd (or falls back to bash). When the agent exits, `remain-on-exit` + `pane-died` hook respawn a clean shell.
