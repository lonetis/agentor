# Agentor MCP server

Agentor is a self-hosted orchestrator for AI coding agents. It runs **workers**: isolated Docker containers (Ubuntu 24.04) with Claude Code, Codex and Gemini CLIs pre-installed, a persistent `/workspace`, a tmux session, a virtual desktop (Xvfb + Chromium), VS Code in the browser, and optional Docker-in-Docker. This MCP server gives you the same control over the platform as a human has in the Agentor web dashboard, acting as the user who authorized you. Admin users additionally get user management, logs, settings and image updates.

Tools map 1:1 onto Agentor's REST API. In tool names, **container = worker**. Every worker-scoped tool takes the worker's UUID as `id` (from `list_containers` / `create_container`), never its display name.

## Core concepts

- **Worker** — a container with a UUID `id`, an editable `displayName`, a `status` (`creating`, `running`, `stopped`, `error`, `removing`), and settings: `environmentId`, `repos` (git repositories cloned into `/workspace` at start), `mounts` (host bind mounts), `initScript` (the command run in tmux window 0 when the worker starts, e.g. launching `claude`). Editing `environmentId`/`repos`/`mounts`/`initScript` via `update_container_settings` only takes effect after `rebuild_container` (`pendingRebuild: true` until then); `displayName` applies immediately.
- **Environment** — reusable worker configuration: CPU/memory limits, network policy (`full`, `package-managers`, `custom` allow-list, `block`, `block-all`), Docker-in-Docker, custom env vars (`KEY=VALUE` lines), a setup script run before the agent starts, which capabilities/instructions are installed, which worker-self APIs are exposed, and which git providers' credentials workers get (`enabledGitProviderIds`: `null` = all, default; `[]` = none, for running untrusted code without access to the user's repositories; or a list of ids from `list_git_providers` — public repos still clone everywhere). One built-in `default` environment exists.
- **Capability** — a skill document (Agent Skills format: markdown with YAML frontmatter) installed into every agent CLI of workers whose environment enables it.
- **Instruction** — an AGENTS.md-style markdown document merged into the agents' global instructions (CLAUDE.md / AGENTS.md / GEMINI.md).
- **Init script** — a reusable bash script offered when creating a worker (built-ins: `claude`, `codex`, `gemini` launch the agent in YOLO mode). Pass its `content` as the worker's `initScript`.
- **Port mapping** — exposes a worker's internal TCP port on a host port (`localhost` = host-only, `external` = network-reachable).
- **Domain mapping** — routes `subdomain.baseDomain[/path]` (HTTP/HTTPS/TCP, optional basic auth, optional wildcard) to a worker port through Traefik. Only available when `get_domain_mapper_status` reports `enabled: true`; use one of its `baseDomains`.
- **Apps** — per-worker services: `chromium` (CDP), `socks5` proxy, `vscode` tunnel, `ssh` server (auto-maps an external port in 22000–22999).
- **Archive vs delete** — `archive_container` removes the container but keeps workspace, agent data and mappings (`unarchive_worker` restores it); `delete_container` / `delete_archived_worker` erase everything permanently.
- **Git providers** — GitHub, gitlab.com and any self-managed GitLab servers the admin configured (`list_git_providers`). A worker repo is `{ provider, url, branch? }` where `url` is a clone URL or a repo path on that provider (`owner/repo`, `group/subgroup/project`). With the user's token for a provider (its `tokenEnvVar` among the account env vars), private repos clone and `list_git_repos` / `list_git_branches` / `create_git_repo` work.
- **Account** — per-user env vars injected into every worker the user owns (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `ANTHROPIC_API_KEY`, ... — values are secrets), the SSH public key used by the `ssh` app, and agent OAuth logins shared across the user's workers.

## Typical workflows

**Start an agent on a task**
1. `list_environments` and `list_init_scripts` (optionally create an environment first).
2. `create_container` with `displayName`, `environmentId`, `repos`, and `initScript` (e.g. the `content` of the `claude` init script). It returns once the container is running; the agent CLI starts in tmux window 0.
3. Talk to the agent: `send_tmux_keys` with `windowIndex: 0`, `text: "<prompt>"`, `enter: true`; poll `capture_tmux_window` to read its screen. Coding agents may show a trust/permission prompt on first start — capture the window and answer it (e.g. `keys: ["Enter"]`).
4. Inspect results with `exec_command` (e.g. `git -C /workspace/<repo> log --oneline -5`) or `download_workspace`.

**Run commands** — `exec_command` runs a bash command as the `agent` user (passwordless sudo) and returns `exitCode`, `stdout`, `stderr`. Prefer it for one-shot commands; use tmux windows (`create_tmux_window` + `send_tmux_keys` + `capture_tmux_window`) for long-running or interactive processes such as dev servers, and leave window 0 to the worker's agent.

**Files** — `upload_to_workspace` writes files (text or base64) under `/workspace`; `download_workspace` returns a `.tar.gz` of `/workspace` or a sub-path. For reading a single text file, `exec_command` with `cat` is simplest.

**Desktop / browser** — `get_desktop_screenshot` returns a PNG of the worker's virtual display; `send_desktop_input` clicks, types, presses keys and scrolls (coordinates in screenshot pixels). Launch GUI apps with `exec_command` (`DISPLAY=:99` is preset), e.g. `chromium --no-first-run https://example.com &`.

**Expose a service** — start it in a tmux window, then `create_port_mapping` (`workerId`, `internalPort`, `externalPort`, `type`) or `create_domain_mapping`.

**Lifecycle** — `stop_container` / `restart_container`, `rebuild_container` (fresh container from the latest image, keeps workspace and mappings), `archive_container` / `unarchive_worker`, `delete_container`.

## Rules of thumb

- Resolve ids with list tools before mutating; never guess UUIDs.
- Worker-scoped tools need a **running** worker (except lifecycle and settings tools). Check `status` first; `restart_container` a stopped one.
- Destructive tools (`delete_*`, `archive_container`, `clear_logs`, `apply_updates`) cannot be undone — confirm intent with the user when it is not explicit.
- Errors come back as `HTTP <status>: <message>` from the underlying API; `403` means the resource belongs to another user or needs the admin role.
- `get_usage` shows the remaining Claude/Codex/Gemini subscription quota of the user's logged-in agents; check it before starting large jobs.
