# Agentor

[![Build and Push Docker Images](https://github.com/lonetis/agentor/actions/workflows/docker-build.yml/badge.svg?branch=main)](https://github.com/lonetis/agentor/actions/workflows/docker-build.yml)

Self-hosted alternative to Claude Code Web, Codex in the Cloud, and similar managed agent environments — spawns isolated AI coding agent workers in Docker containers, each with a live terminal, VS Code editor (browser + native tunnel), virtual desktop, TCP port + domain mapping, and GitHub integration, all managed through a web dashboard. Full control over the runtime environment.

![Agentor Dashboard](docs/screenshot.png)

## Pre-installed Agents

All agents are installed in a single unified worker image. Start any agent via init script presets or manually in the terminal. **Credentials are scoped per user** — each user logs in (or sets their own API key) once, and that account's tokens are shared across all of their workers.

| Agent | | OAuth Login (per user, inside any worker) | Or set as API key (per user, in Account modal) |
|-------|---|-------------------------------------------|------------------------------------------------|
| **Claude** | [anthropics/claude-code](https://github.com/anthropics/claude-code) | `claude` → `/login` | `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) |
| **Codex** | [openai/codex](https://github.com/openai/codex) | `codex login --device-auth` | `OPENAI_API_KEY` |
| **Gemini** | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | `gemini` → `/auth` | `GEMINI_API_KEY` |

## Features

- **User authentication & RBAC** — email/password/passkey login powered by [better-auth](https://www.better-auth.com/) with admin and user roles; admins create and manage other users, each user sees only their own workers/mappings/environments/etc. First-run setup creates the initial admin.
- **Live terminal** — xterm.js WebSocket terminal with tmux session management
- **VS Code editor** — code-server (VS Code in the browser) per worker, accessible in a split pane
- **VS Code tunnel** — connect your local VS Code client to workers via Microsoft's relay (GitHub device code auth per worker, persists across restarts)
- **Virtual desktop** — Xvfb + fluxbox + noVNC, accessible in-browser
- **Multi-repo cloning** — clone one or more git repos into each worker at startup
- **App system** — launch Chromium (with CDP) or SOCKS5 proxy instances inside workers
- **Port & domain mapping** — unified Traefik reverse proxy handling both TCP port forwarding (localhost- or network-bound) and subdomain-based HTTP/HTTPS/TCP routing with TLS (Let's Encrypt HTTP-01/DNS-01 or self-signed CA), optional HTTP basic auth
- **Auto-updates** — per-image or bulk image updates in production mode with registry-agnostic digest comparison (GHCR + Docker Hub), orchestrator self-replaces
- **Resource limits** — per-worker CPU and memory constraints
- **Volume mounts** — bind-mount host directories into workers
- **Persistent workspaces** — workspace data survives container stops, restarts, and archiving via named Docker volumes
- **Worker archiving** — archive workers to free resources while preserving workspace data; unarchive to restore
- **File upload/download** — upload files/folders to running workers or during creation, download workspace as `.tar.gz`
- **Docker-in-Docker** — opt-in per-environment, full Docker daemon inside workers (build, run, compose)
- **Usage monitoring** — real-time usage/rate limit indicators for OAuth-authenticated agents (Claude, Codex, Gemini)
- **Centralized logging** — collects logs from all containers (orchestrator, workers, traefik) with NDJSON storage, log rotation, and a live-streaming log viewer in the dashboard
- **Theme toggle** — switch between system default, light, and dark mode
- **API docs** — auto-generated OpenAPI 3.1.0 spec with interactive Scalar UI at `/api/docs`

---

## Quick Start

No need to clone the repo — all images are pulled from GHCR.

```bash
curl -fsSL https://raw.githubusercontent.com/lonetis/agentor/main/install.sh | bash
```

This downloads `docker-compose.yml` and `.env` into the current directory. Then:

1. `docker compose up -d`
2. Open **http://localhost:3000** and create your admin account
3. Click your name in the sidebar footer → **Account** → fill in API keys / GitHub token, or follow the [Agent login (per user)](#agent-login-per-user) section to sign in via OAuth

`.env` only contains orchestrator-wide settings (logging, Traefik, dashboard auth). All agent API keys, the GitHub token, and any custom env vars are configured per user from the dashboard.

---

## Getting Started (from source)

### Prerequisites

- Docker Engine 24+ with Compose v2

### Configure

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` if you want to override any orchestrator-wide settings (everything works out of the box). All user-scoped secrets — agent API keys, GitHub token, custom env vars — are configured per user from the **Account** modal in the dashboard, not via `.env`.

---

### Development

Development mode mounts the orchestrator source code into the container with hot reload.

1. **Build the worker image locally** (Traefik is pulled from Docker Hub automatically):

   ```bash
   docker build -t agentor-worker:latest ./worker
   ```

2. **Start the dev server:**

   ```bash
   docker compose -f docker-compose.dev.yml up
   ```

3. Open **http://localhost:3000** — you'll be redirected to `/setup` to create the first admin account on a fresh install.

---

### Production

Production mode uses pre-built images from GHCR — no local builds needed.

```bash
docker compose -f docker-compose.prod.yml up -d
```

Open **http://localhost:3000**

> [!NOTE]
> The production compose file sets `WORKER_IMAGE_PREFIX=ghcr.io/lonetis/` so the orchestrator pulls worker images from GHCR automatically. Docker will pull images on first container creation.

> [!NOTE]
> The Traefik reverse proxy (`agentor-traefik`) is managed automatically by the orchestrator and handles both port mappings and domain mappings on the same container. It is created when the first port/domain mapping is added (or the dashboard subdomain is configured) and removed when all of those are gone. Mapped ports are arbitrary — no fixed ranges — but `80`/`443` are reserved when domain routing is active.

---

## Agent login (per user)

Each user signs in to their own agent subscriptions and stores their own API keys. There is no shared credential pool — what you log in to is yours, and the same tokens are reused across all of your workers.

### Subscription / OAuth login

Log in once inside any of your workers — the agent CLI writes its OAuth token into your account, and every other worker you create (or restart) inherits it automatically.

| Agent | Command |
|-------|---------|
| **Claude** (Pro/Max) | `claude` → `/login` |
| **Codex** (ChatGPT) | `codex login --device-auth` |
| **Gemini** (Code Assist) | `gemini` → `/auth` |

> [!IMPORTANT]
> OAuth refresh tokens rotate on use. **Always** log in inside a worker — never copy tokens from your local machine, or both copies will desync and break authentication on both sides.

Tokens live at `<DATA_DIR>/users/<your-user-id>/credentials/{claude,codex,gemini}.json`. To force a fresh login, click **Reset** next to the agent in **Account → Agent OAuth credentials**.

### API keys

Open the sidebar footer, click your name, then **Account → API keys & tokens**. Set any of:

- `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GITHUB_TOKEN` (used for cloning private repos and `gh` inside your workers)

You can also add arbitrary `KEY=value` pairs in **Custom environment variables** — these get exported into every worker you create.

---

## Storage

By default, all persistent data lives in `./data/` on the host — easy to browse, back up, and migrate. To use a Docker named volume instead, change the `/data` mount in your compose file:

```yaml
# Directory mode (default):
- ./data:/data

# Volume mode:
- agentor-data:/data
```

The storage mode is auto-detected from the mount type — no env var changes needed. In directory mode, worker workspaces live at `./data/workspaces/` and can be accessed directly from the host.

## Ports

| Port | Binding | Purpose |
|------|---------|---------|
| `3000` | `127.0.0.1` | Web dashboard (includes proxied desktop and editor access) |
| `80`, `443` | `0.0.0.0` | Traefik reverse proxy for domain routing (only when `BASE_DOMAINS` is set) |
| _user-defined_ | `127.0.0.1` or `0.0.0.0` | Traefik TCP port mappings (localhost or external type, one entrypoint per mapping) |

## License

MIT
