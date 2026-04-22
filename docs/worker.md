# Worker System

## Unified Worker Image

A single Docker image (`agentor-worker`, built from `worker/`) contains all agent CLIs and their setup scripts. **Credentials are scoped per user**: OAuth/subscription tokens live as JSON files at `<DATA_DIR>/users/<userId>/credentials/{claude,codex,gemini}.json` and are bind-mounted directly into every worker that user owns at the exact path each CLI reads and writes — `/home/agent/.agent-data/.claude/.credentials.json`, `/home/agent/.agent-data/.codex/auth.json`, `/home/agent/.agent-data/.gemini/oauth_creds.json`. Since `~/.<agent>` is symlinked to `.agent-data/.<agent>/` by `worker/entrypoint.sh`, CLI writes land on the host file immediately and every other worker the same user owns sees the update without any restart. In directory mode the orchestrator pre-creates the three mountpoint files under `<DATA_DIR>/users/<userId>/agents/<name>/.<agent>/` before starting the worker so Docker Desktop's virtiofs accepts the nested bind. Different users have completely isolated credentials. API keys, the GitHub token, and arbitrary custom env vars are also per-user — managed from the dashboard's Account modal and persisted in `<DATA_DIR>/users/<userId>/env-vars.json`. Copying OAuth tokens from a local machine is not supported because refresh token rotation would cause the local and worker tokens to go out of sync — always log in inside a worker.

**Worker identity**: every worker has a per-user short `name` (e.g. `happy-panda`, user-provided or auto-generated) and a globally unique `containerName = <containerPrefix>-<userId>-<name>` derived from both. `name` is what the UI shows and what appears in the shell prompt (the container's `Hostname` is set to `name`); `containerName` is the Docker container name, the prefix for per-worker volumes (`<containerName>-workspace`, `-agents`, `-docker`), and the DNS name Traefik routes to. Two different users can each own a worker called `happy-panda` — their `containerName`s diverge via the userId segment. Inside the worker, `$WORKER_CONTAINER_NAME` is the globally unique `containerName`, so worker-facing API shortcuts (port/domain mapping creation) can resolve back to the owning user + worker without ambiguity.

**Structured JSON env vars** — the orchestrator passes 4 JSON env vars to workers instead of 20+ individual variables:
- `ENVIRONMENT` — network mode, allowed domains, dockerEnabled, setupScript, envVars, exposeApis
- `CAPABILITIES` — array of `{ name, content }` entries
- `INSTRUCTIONS` — array of `{ name, content }` entries
- `WORKER` — name, displayName, repos, initScript, gitName, gitEmail

Individual env vars that CLIs read directly are populated **from the worker owner's per-user `UserEnvVars` record**: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, plus any custom keys the user added. Two infrastructural env vars are added by the orchestrator regardless of user: `ORCHESTRATOR_URL`, `WORKER_CONTAINER_NAME`.

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
- VS Code CLI (tunnel mode — native VS Code client connections via Microsoft relay)
- App management scripts in `/home/agent/apps/` (chromium/manage.sh, socks5/manage.sh, vscode-tunnel/manage.sh, ssh/manage.sh). Every app exposes the same `start <id> <port> [extraArgs…]` / `stop <id>` / `list` interface and emits NDJSON on stdout.
- OpenSSH server (`openssh-server`, port 22, pubkey-only via `StrictModes no` + bind-mounted `/home/agent/.ssh/authorized_keys`)
- Shared `agent` user (uid 1000) with passwordless sudo
- Helper scripts: `memfd-exec.py` (memfd script executor), `setup.sh` (setup script runner), `init.sh` (init script runner)
- Common entrypoint: tmux session, env var export, agent setups (+ platform files), docker daemon, display stack, code-server, git identity + auth, repo clone, network firewall, setup script (memfd), init script (memfd), launch. The VS Code tunnel and SSH server are apps (started via the Apps pane) — not auto-started by the entrypoint.

### Pre-installed Agents

- **Claude**: Anthropic Claude Code CLI (`worker/agents/claude/`)
- **Codex**: OpenAI Codex CLI (`worker/agents/codex/`)
- **Gemini**: Google Gemini CLI (`worker/agents/gemini/`)

### Adding a New Agent

1. Install the CLI in `worker/Dockerfile`
2. Create `worker/agents/<agent-id>/setup.sh` (auth/settings + capabilities/instructions writing — reads from `CAPABILITIES` and `INSTRUCTIONS` JSON env vars)
3. Add an agent config entry in `orchestrator/server/utils/agent-config.ts` (API domains, env vars referencing fields on `UserEnvVars`)
4. Add a built-in init script file in `orchestrator/server/built-in/init-scripts/`
5. Add a credential mapping in `orchestrator/server/utils/user-credentials.ts` (`AGENT_CREDENTIAL_MAPPINGS`) — fileName + container path. The file lives under `<DATA_DIR>/users/<userId>/credentials/` and is bind-mounted into each of that user's workers.
6. Rebuild the worker image

No entrypoint changes needed — agent setup scripts handle all agent-specific logic (auth, settings, capabilities, instructions).

## Init Script System

Init scripts are managed via `InitScriptStore` (`orchestrator/server/utils/init-script-store.ts`), stored as JSON in `<DATA_DIR>/init-scripts.json`. Built-in init script files live in `orchestrator/server/built-in/init-scripts/` as plain `.sh` files — the filename (without extension) is both the ID and the name. Custom scripts can be created via the Init Scripts modal in the sidebar. Init scripts are just bash scripts — they are not tied to any specific agent.

Agent-specific configuration (API domains) lives separately in `orchestrator/server/utils/agent-config.ts` as a static registry (`AGENT_CONFIGS`). This provides `getAllAgentApiDomains()` (firewall allowlist). Worker env vars come from the worker owner's `UserEnvVars` record via `renderUserEnvVars()`.

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

## Git Identity

Each worker's git identity is configured from the creating user's profile (name and email from the auth system). The orchestrator passes `gitName` and `gitEmail` in the `WORKER` JSON env var, and the entrypoint sets `git config --global user.name` and `user.email` accordingly. This means when user A creates a worker, all git commits inside that worker are attributed to user A. Agent CLIs add `Co-authored-by` trailers to their commits for attribution. The identity persists across rebuild and archive/unarchive (stored in `WorkerRecord`).

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
0a. **Agent data symlinks** — if `/home/agent/.agent-data` is mounted, create symlinks from `~/.claude`, `~/.gemini`, `~/.codex`, `~/.agents`, `~/.claude.json` to volume subdirectories. Fixes ownership (`chown -R agent:agent`).
0b. **Export env vars** — `EXPOSE_*` flags from `ENVIRONMENT.exposeApis`, custom env vars from `ENVIRONMENT.envVars` (exported + set in tmux environment)
1. **Agent setup** — all `agents/*/setup.sh` scripts (CLI config merged with existing, capabilities + instructions on first startup — OAuth credentials are bind-mounted on top of agent data volume). Sentinel file touched after all scripts complete.
2. **Docker daemon** — if `ENVIRONMENT.dockerEnabled`: start dockerd, wait for socket (up to 30s); otherwise skipped
3. **Display stack** — Xvfb + fluxbox + x11vnc + websockify/noVNC, wait for each service
3b. **Code editor** — code-server on port 8443 (`--auth none --bind-addr 0.0.0.0:8443`), wait for port ready
4. **Git identity + auth** — sets `git config --global user.name/email` from `WORKER.gitName`/`WORKER.gitEmail` (creating user's profile); if the worker owner's `GITHUB_TOKEN` is set in their account env vars: configures `gh` credential helper; otherwise skipped
5. **Repository clone** — if `WORKER.repos`: parallel clone per repo, wait for all; otherwise skipped
6. **Network firewall** — reads `ENVIRONMENT.networkMode` + `.allowedDomains` via jq; dnsmasq + ipset + iptables; skipped for `full` mode
7. **User setup script** — runs `/home/agent/setup.sh` which reads `ENVIRONMENT.setupScript` and executes via memfd (no temp files)
8. **Launch** — `tmux respawn-pane -k` replaces loading screen; `/home/agent/init.sh` reads `WORKER.initScript` and executes via memfd (or falls back to bash). When the agent exits, `remain-on-exit` + `pane-died` hook respawn a clean shell.
