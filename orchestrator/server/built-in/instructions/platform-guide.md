# Agentor Platform Guide

## What is Agentor?

Agentor is a platform for running AI coding agents in isolated Docker containers called **workers**. A human operator uses the Agentor web dashboard to create workers, configure their environments, and monitor their activity. You — the AI agent — run inside one of these workers.

## Architecture overview

There are four components in the platform:

- **Orchestrator** — The central server. It provides the web dashboard, manages all workers, and exposes a REST API. It runs as a Docker container (`agentor-orchestrator`) on the same network as your worker.
- **Workers** — Isolated Ubuntu containers where agents run. Each worker has its own filesystem, network stack, and persistent workspace. You are running inside a worker right now.
- **Port Mapper** — An optional proxy container that forwards host ports to internal worker ports. It is managed by the orchestrator and created automatically when port mappings are configured. This is how services running inside workers (like dev servers) become accessible from outside.
- **Traefik** — An optional reverse proxy that maps domain names to worker ports with automatic TLS. It is managed by the orchestrator and created when domain mappings are configured. This is how workers can serve traffic on proper domain names.

You can interact with the orchestrator's API from inside your worker to manage port mappings, domain mappings, and check usage quotas — if these capabilities have been enabled for your environment. Skills for these APIs may be available to you.

## Your worker environment

### System

- **OS:** Ubuntu 24.04 LTS
- **User:** `agent` (uid 1000) with passwordless sudo
- **Shell:** bash
- **Workspace:** `/workspace` — this is your main working directory. It is stored on a persistent Docker volume that survives container restarts and even archiving/unarchiving of the worker. Always work here.
- **Home:** `/home/agent`

### Installed tools

- **Languages:** Node.js 22 LTS (npm, npx), Python 3 (pip), build-essential (gcc, make)
- **Editors:** neovim, vim, nano
- **VCS:** git, gh (GitHub CLI)
- **Search:** ripgrep (rg), fd-find (fd)
- **Terminal:** tmux (your session is named `main` — you're already inside it)
- **Utilities:** jq, curl, wget, tree, less, htop, btop, rsync, strace, file, man-db
- **Network:** openssh-client, dnsutils, net-tools, iputils-ping

### Display and browsers

A virtual display is running (Xvfb on `:99` with fluxbox). Set `DISPLAY=:99` to launch graphical applications. Chromium and Playwright (with bundled Chromium and Firefox) are available for browser automation. VS Code (code-server) is available in the browser via the orchestrator dashboard.

### Docker-in-Docker

If Docker is enabled for this environment (`DOCKER_ENABLED=true`), a Docker daemon runs inside this container. The `agent` user is in the `docker` group — no sudo needed. Docker Compose, BuildKit, and all standard Docker features work natively. Docker data persists across container restarts.

### Network access

Network access depends on your environment's configuration. Some environments allow full internet access, others restrict outbound connections to specific domains using a DNS-based firewall. Regardless of the firewall mode, the orchestrator and other containers on the Docker network are always reachable.

### Key environment variables

- `ORCHESTRATOR_URL` — Base URL of the orchestrator API (e.g. `http://agentor-orchestrator:3000`)
- `WORKER_CONTAINER_NAME` — This worker container's name, used to identify yourself when calling orchestrator APIs
- `DOCKER_ENABLED` — `true` if Docker-in-Docker is available
- `GITHUB_TOKEN` — GitHub personal access token (if configured). The `gh` CLI is pre-authenticated when this is set
- `DISPLAY` — X11 display (`:99`)
