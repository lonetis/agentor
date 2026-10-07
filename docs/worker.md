# Worker System

## Unified Worker Image

A single Docker image (`agentor-worker`, built from `worker/`) contains all agent CLIs and their setup scripts. **Credentials are scoped per user**: OAuth/subscription tokens live as JSON files at `<DATA_DIR>/users/<userId>/credentials/{claude,codex,gemini}.json` and are bind-mounted directly into every worker that user owns at the exact path each CLI reads and writes — `/home/agent/.agent-data/.claude/.credentials.json`, `/home/agent/.agent-data/.codex/auth.json`, `/home/agent/.agent-data/.gemini/oauth_creds.json`. Since `~/.<agent>` is symlinked to `.agent-data/.<agent>/` by `worker/entrypoint.sh`, CLI writes land on the host file immediately and every other worker the same user owns sees the update without any restart. In directory mode the orchestrator pre-creates the three mountpoint files under `<DATA_DIR>/users/<userId>/agents/<id>/.<agent>/` before starting the worker so Docker Desktop's virtiofs accepts the nested bind. Different users have completely isolated credentials. Env vars (API keys, git provider tokens, and any custom keys) are also per-user — managed from the dashboard's Account modal and persisted as a uniform key/value list in `<DATA_DIR>/users/<userId>/env-vars.json` (`{ envVars: [{ key, value }] }`, keyed by the env var NAME, no hardcoded fields). The SSH public key is kept separately at `<DATA_DIR>/users/<userId>/ssh/authorized_keys` (managed via `/api/account/ssh-key`, not part of env-vars.json). Copying OAuth tokens from a local machine is not supported because refresh token rotation would cause the local and worker tokens to go out of sync — always log in inside a worker.

**Worker identity**: every worker has an immutable UUID `id` (a server-minted UUID v4 — clients never choose it) and a derived `containerName = agentor-worker-<id>`. `id` is the worker's stable internal identity — the WorkerStore key, the `agentor.id` label, the basis for `containerName`, and stable across rebuild/unarchive. The Docker container id (`containerId`) changes on every rebuild; the orchestrator resolves `id` → current `containerId` when it needs to talk to Docker. No custom `Hostname` is set on the container, so Docker defaults it to the short container id — the in-container `hostname` command and the shell prompt show that docker short id (e.g. `16b082a7681b`), not the worker UUID. `containerName` is the Docker container name, the prefix for per-worker volumes (`<containerName>-workspace`, `-agents`, `-docker`), and the DNS name Traefik routes to. The user-facing label is a separate editable `displayName` (free-form, not required to be unique, renameable via `PATCH /api/containers/:id`) — that is what the dashboard shows. Inside the worker, `$WORKER_CONTAINER_NAME` is the globally unique `containerName`, so worker-facing API shortcuts (port/domain mapping creation) can resolve back to the owning user + worker without ambiguity.

**Structured JSON env vars** — the orchestrator passes 4 JSON env vars to workers instead of 20+ individual variables:
- `ENVIRONMENT` — network mode, allowed domains, dockerEnabled, setupScript, envVars, exposeApis
- `CAPABILITIES` — array of `{ name, content }` entries
- `INSTRUCTIONS` — array of `{ name, content }` entries
- `WORKER` — id, displayName, repos, initScript, gitName, gitEmail, gitProviders

Individual env vars that CLIs read directly are populated **from the worker owner's per-user `UserEnvVars` record** via `renderUserEnvVars` — the record's uniform `envVars` list (`[{ key, value }]`, keyed by the env var NAME) is rendered verbatim, so `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, `GITLAB_TOKEN` / `GITLAB_<NAME>_TOKEN`, and any custom keys the user added all flow through the same path with no special-casing. Two infrastructural env vars are added by the orchestrator regardless of user: `ORCHESTRATOR_URL`, `WORKER_CONTAINER_NAME`.

### Worker Image Contents

The unified worker image (`worker/`) provides:
- Ubuntu 24.04, Node.js 22 LTS, git, tmux, curl, build-essential, python3, ripgrep, fd-find, jq, sudo, locale
- Display stack: Xvfb, fluxbox, x11vnc, noVNC/websockify (port 6080)
- Desktop automation: maim (PNG screenshots) + xdotool (mouse / keyboard) — used by the orchestrator's `desktop/screenshot` and `desktop/input` API (and the matching MCP tools) through `docker exec` on `DISPLAY=:99`
- Code editor: code-server (VS Code in browser, port 8443)
- Browsers: Chromium (from Debian bookworm repo), Playwright (with bundled Chromium + Firefox)
- microsocks (SOCKS5 proxy)
- Editors: neovim, vim, nano
- Utilities: htop, btop, tree, less, openssh-client, rsync, strace, dnsutils, net-tools, iputils-ping, file, man-db
- Network firewall: dnsmasq, ipset, iptables (for environment network policies)
- Git hosting CLIs: GitHub CLI (`gh`) and GitLab CLI (`glab`)
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
3. Add an agent config entry in `orchestrator/server/utils/agent-config.ts` (the agent's API domains for the firewall allowlist — env vars are not configured here; they flow from the user's `UserEnvVars` via `renderUserEnvVars()`)
4. Add a built-in init script file in `orchestrator/server/built-in/init-scripts/`
5. Add a credential mapping in `orchestrator/server/utils/user-credentials.ts` (`AGENT_CREDENTIAL_MAPPINGS`) — fileName + container path. The file lives under `<DATA_DIR>/users/<userId>/credentials/` and is bind-mounted into each of that user's workers.
6. Rebuild the worker image

No entrypoint changes needed — agent setup scripts handle all agent-specific logic (auth, settings, capabilities, instructions).

## Init Script System

Init scripts are managed via `InitScriptStore` (`orchestrator/server/utils/init-script-store.ts`), stored as JSON in `<DATA_DIR>/init-scripts.json`. Built-in init script files live in `orchestrator/server/built-in/init-scripts/` as plain `.sh` files — the filename (without extension) is the name; the id is a stable UUID derived from it. Custom scripts can be created via the Init Scripts modal in the sidebar. Init scripts are just bash scripts — they are not tied to any specific agent.

Agent-specific configuration (API domains) lives separately in `orchestrator/server/utils/agent-config.ts` as a static registry (`AGENT_CONFIGS`). This provides `getAllAgentApiDomains()` (firewall allowlist). Worker env vars come from the worker owner's `UserEnvVars` record via `renderUserEnvVars()`.

The UI provides a dropdown to select a script, which populates an editable init script textarea. Users can modify the script or write fully custom ones. The dropdown syncs both ways — editing the textarea to match a script selects it, clearing it switches to None, and any other edit switches to Custom. A "Manage" button opens the Init Scripts modal for CRUD operations.

**Built-in init scripts (3):**
- `claude` — Claude Code CLI with `--dangerously-skip-permissions`
- `codex` — OpenAI Codex CLI with `--dangerously-bypass-approvals-and-sandbox`
- `gemini` — Google Gemini CLI with `--yolo`

## Git Provider System

Git providers are defined in `orchestrator/server/utils/git-providers.ts`. `listGitProviders()` returns GitHub and gitlab.com (built in) followed by one provider per self-managed GitLab server in `GITLAB_INSTANCES` (parsed into `config.gitlabInstances`; see `.env.example`). Each `GitProvider` has:
- `id` — what a worker repo's `provider` field references (`github`, `gitlab`, `gitlab-<name>`)
- `type` (`github` | `gitlab`) — selects the hosting API client and the worker-side auth setup
- `url` — web base URL (no trailing slash, may include a GitLab relative URL root); clone URLs, the API base and per-host git credentials derive from it
- `tokenEnvVar` — the env var NAME holding the user's token in their per-user env vars (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITLAB_<NAME>_TOKEN`). There is no separate token store.
- `cloneDomains` — injected into restricted firewall modes so cloning and pushing work (a self-managed instance contributes its hostname)
- `containerRegistry` (optional) — the DinD daemon logs into it with the provider token (`ghcr.io`, `registry.gitlab.com`; not derivable for self-managed GitLab)

`parseRepoConfigs()` validates the `repos` field on worker create/PATCH — an unknown provider id is a 400.

**Hosting API** (`git-hosting-client.ts`, `git-hosting.ts`, `github.ts`, `gitlab.ts`): `GitHostingService` is the provider-neutral interface the dashboard needs (`getUsername`, `listRepos`, `listNamespaces`, `listBranches`, `createRepo`). `GitHostingClient` holds the shared HTTP plumbing — auth headers, 30s timeouts, a 60s per-instance response cache, pagination, and error mapping (upstream 401 → 502 so a rejected provider token is never confused with the caller's own session; 422 → 400; 5xx/unreachable → 502; no response within 30s → 504). `GitHubService` paginates via `Link`. `GitLabService` lists projects with keyset pagination (`pagination=keyset&order_by=id`): offset pages make GitLab count the whole membership set and skip every earlier row per page, which on large or cold self-managed instances runs into GitLab's own query timeout (500). It pages on its own URL — taking only the query of a `Link` header, else `X-Next-Page` — because GitLab builds `Link` from its configured external URL, which on self-managed instances often differs from the URL the orchestrator uses. GitLab authenticates with `Authorization: Bearer` (personal, group/project and OAuth tokens), counts `internal` projects as private and maps nested groups to `fullName` paths like `group/subgroup/project`. `getGitHostingService(provider, token)` caches instances per provider + token (5 min idle eviction, LRU-capped). Routes: `/api/git-providers` (list + per-user `tokenConfigured`), `/api/git-providers/:providerId/{repos,branches}` — `resolveGitProviderForUser()` / `requireGitHostingService()` turn the route param into a 404 or a token-less 400.

**Worker side**: the orchestrator bakes `listWorkerGitProviders()` (`{ id, type, url, tokenEnvVar, containerRegistry? }`) into `WORKER.gitProviders`, so the entrypoint is data-driven:
- **Auth** (Phase 4) — for every provider whose `tokenEnvVar` is set: `github` → `gh auth git-credential` as the credential helper for its origin (and `GH_TOKEN`); `gitlab` → an inline credential helper for its origin that prints `username=oauth2` and `password=$<TOKEN_VAR>` read from the environment at use time (the token is never written to git config), plus per-host `glab` config (token, `api_protocol`, `git_protocol https`, `api_host` for a port or relative URL root; a host with a port also gets a bare-host alias because `glab --hostname` rejects ports). Every provider gets `url.<url>/.insteadOf git@<host>:` so SSH-style URLs use HTTPS credentials.
- **Clone** (Phase 5) — `github` repos use `gh repo clone`; others use `git clone`, resolving a repo path (`group/subgroup/project`) to `<provider url>/<path>.git`.
- **DinD** (Phase 2) — `docker login` to each provider's `containerRegistry` with its token.

glab gives a `GITLAB_TOKEN` environment variable precedence over its per-host config for **every** host. A user with tokens for both gitlab.com and a self-managed instance therefore needs `env -u GITLAB_TOKEN glab …` for glab commands against the instance (git itself is unaffected — its helpers are per host). The platform guide tells agents this.

**Adding a provider type** (e.g. Gitea, GitHub Enterprise):
1. Add the type to `GitProviderType` (`shared/types.ts`) and the registry entries / config parsing in `git-providers.ts` (+ `config.ts` for configurable instances)
2. Implement a `GitHostingClient` subclass and return it from `createService()` in `git-hosting.ts`
3. Add an auth case to `configure_git_provider` (and a clone case if plain `git clone` with path resolution is not enough) in `worker/entrypoint.sh`; install its CLI in `worker/Dockerfile`
4. Document the token env var in `.env.example`

**Current providers:** GitHub (`gh`), gitlab.com and self-managed GitLab (`glab`).

## Git Identity

Each worker's git identity is the **owning user's** profile (name and email from the auth system), **resolved live at build time** from the worker's `userId` — it is not stored on the worker. At create/rebuild/unarchive the orchestrator looks the owner up (`getUserById`) and passes `gitName` and `gitEmail` in the `WORKER` JSON env var; the entrypoint sets `git config --global user.name` and `user.email` accordingly. This means when user A creates a worker, all git commits inside that worker are attributed to user A. Agent CLIs add `Co-authored-by` trailers to their commits for attribution. Because the identity is resolved (not snapshotted), it survives rebuild and archive/unarchive automatically and always reflects the user's current profile.

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
2. **Docker daemon** — if `ENVIRONMENT.dockerEnabled`: start dockerd, wait for socket (up to 30s), log in to each git provider's container registry the user has a token for; otherwise skipped
3. **Display stack** — Xvfb + fluxbox + x11vnc + websockify/noVNC, wait for each service
3b. **Code editor** — code-server on port 8443 (`--auth none --bind-addr 0.0.0.0:8443`), wait for port ready
4. **Git identity + auth** — sets `git config --global user.name/email` from `WORKER.gitName`/`WORKER.gitEmail` (creating user's profile), then per-host credentials (+ `glab` config) for every provider in `WORKER.gitProviders` whose token env var is set (see **Git Provider System**); skipped when there is neither an identity nor a token
5. **Repository clone** — if `WORKER.repos`: parallel clone per repo (`gh repo clone` for GitHub, `git clone` with path → URL resolution otherwise), wait for all; otherwise skipped
6. **Network firewall** — reads `ENVIRONMENT.networkMode` + `.allowedDomains` via jq; dnsmasq + ipset + iptables; skipped for `full` mode
7. **User setup script** — runs `/home/agent/setup.sh` which reads `ENVIRONMENT.setupScript` and executes via memfd (no temp files)
8. **Launch** — `tmux respawn-pane -k` replaces loading screen; `/home/agent/init.sh` reads `WORKER.initScript` and executes via memfd (or falls back to bash). When the agent exits, `remain-on-exit` + `pane-died` hook respawn a clean shell.
