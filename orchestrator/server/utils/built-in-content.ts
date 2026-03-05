export interface BuiltInSkill {
  id: string;
  content: string;
}

export interface BuiltInInstruction {
  id: string;
  name: string;
  content: string;
}

export const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    id: 'builtin-port-mapping',
    content: `---
name: port-mapping
description: Expose a port from your worker to the host machine or network. Use when you need to make a dev server, API, database, or any service running inside this container accessible from outside.
user-invocable: false
---

# Expose a port from your worker to the host machine or network

Use this skill when you need to make a service running inside this worker container accessible from outside — for example, to let the user visit a web app you're developing, expose a dev server, or make an API reachable from the host machine or the internet.

## How it works

Your worker runs inside an isolated Docker container. Ports inside the container are not directly reachable from the host machine. The orchestrator provides a **port mapper** that creates TCP proxies from host ports to your internal ports.

There are two mapping types:
- **localhost** — The port is only accessible from the host machine (127.0.0.1)
- **external** — The port is accessible from any machine on the network (0.0.0.0)

## API Reference

All requests go to the orchestrator at \`$ORCHESTRATOR_URL\`. Your container is identified by \`$WORKER_CONTAINER_NAME\`. Both are pre-set environment variables.

### Create a port mapping

\`\`\`bash
curl -X POST "$ORCHESTRATOR_URL/api/port-mappings" \\
  -H "Content-Type: application/json" \\
  -d '{
    "externalPort": 9000,
    "type": "localhost",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000
  }'
\`\`\`

This maps host port 9000 to port 3000 inside your container. The user can then open \`http://localhost:9000\` on the host.

**Required fields:**
- \`externalPort\` (integer) — The port on the host machine (1-65535)
- \`type\` — \`"localhost"\` (host only) or \`"external"\` (network-accessible)
- \`workerName\` (string) — Always use \`$WORKER_CONTAINER_NAME\`
- \`internalPort\` (integer) — The port your service listens on inside this container (1-65535)

### List all port mappings

\`\`\`bash
curl "$ORCHESTRATOR_URL/api/port-mappings"
\`\`\`

Returns a JSON array of all active port mappings across all workers.

### Delete a port mapping

\`\`\`bash
curl -X DELETE "$ORCHESTRATOR_URL/api/port-mappings/9000"
\`\`\`

Removes the mapping on host port 9000. Replace \`9000\` with the external port number.

## Common use cases

1. **Dev server** — Start a server on port 3000 inside the container, map it to a host port so the user can access it in their browser
2. **API endpoint** — Expose a backend service for external testing or webhook delivery
3. **Database** — Expose a database port for access from host tools (use \`localhost\` type for security)
`,
  },
  {
    id: 'builtin-domain-mapping',
    content: `---
name: domain-mapping
description: Map a domain or subdomain to a port in your worker. Use when you need to serve traffic on a proper domain name with HTTPS, set up webhook endpoints, or expose a public-facing service.
user-invocable: false
---

# Map a domain or subdomain to a port in your worker

Use this skill when you need to make a service accessible via a proper domain name (e.g. \`myapp.example.com\`) instead of just an IP and port. This is useful for public-facing services, webhook endpoints that require HTTPS, or any scenario where a clean URL matters.

## How it works

The orchestrator manages a **Traefik reverse proxy** that routes incoming requests based on domain names to the correct worker and port. It handles TLS certificates automatically via Let's Encrypt.

Domain mapping is only available when the orchestrator has base domains configured. Always check availability first before attempting to create a mapping.

## API Reference

All requests go to the orchestrator at \`$ORCHESTRATOR_URL\`. Your container is identified by \`$WORKER_CONTAINER_NAME\`. Both are pre-set environment variables.

### Check if domain mapping is available

\`\`\`bash
curl "$ORCHESTRATOR_URL/api/domain-mapper/status"
\`\`\`

Returns \`enabled: true/false\` and a list of available \`baseDomains\`. If \`enabled\` is \`false\`, domain mapping is not configured and the other endpoints will not work.

### Create a domain mapping

\`\`\`bash
curl -X POST "$ORCHESTRATOR_URL/api/domain-mappings" \\
  -H "Content-Type: application/json" \\
  -d '{
    "subdomain": "myapp",
    "baseDomain": "example.com",
    "protocol": "https",
    "workerName": "'"$WORKER_CONTAINER_NAME"'",
    "internalPort": 3000
  }'
\`\`\`

This makes \`https://myapp.example.com\` route to port 3000 inside your container.

**Required fields:**
- \`baseDomain\` (string) — Must be one of the domains from the status endpoint
- \`protocol\` — \`"http"\`, \`"https"\`, or \`"tcp"\`. HTTPS and TCP require TLS to be configured on the base domain
- \`workerName\` (string) — Always use \`$WORKER_CONTAINER_NAME\`
- \`internalPort\` (integer) — The port your service listens on inside this container (1-65535)

**Optional fields:**
- \`subdomain\` (string) — The subdomain prefix. Leave empty (\`""\`) to map the bare base domain itself (e.g. \`example.com\` instead of \`something.example.com\`)
- \`basicAuth\` (object) — \`{ "username": "user", "password": "pass" }\` to protect with HTTP basic authentication

### List all domain mappings

\`\`\`bash
curl "$ORCHESTRATOR_URL/api/domain-mappings"
\`\`\`

Returns a JSON array of all active domain mappings across all workers. Each entry includes an \`id\` field needed for deletion.

### Delete a domain mapping

\`\`\`bash
curl -X DELETE "$ORCHESTRATOR_URL/api/domain-mappings/MAPPING_ID"
\`\`\`

Replace \`MAPPING_ID\` with the \`id\` from the list response.

## Common use cases

1. **Public web app** — Deploy a site accessible at \`https://myapp.example.com\` with automatic TLS
2. **Webhook receiver** — Create an HTTPS endpoint for GitHub webhooks, Stripe callbacks, etc.
3. **API gateway** — Expose a backend API on a clean domain with optional basic auth protection
`,
  },
  {
    id: 'builtin-usage',
    content: `---
name: usage-monitoring
description: Check your remaining agent usage quota. Use when you need to check rate limits, remaining capacity, or plan around quota resets before starting a large task.
user-invocable: false
---

# Check your remaining agent usage quota

Use this skill when you need to check how much of your usage quota is remaining, whether you're close to a rate limit, or when your quota resets. This is useful for planning long-running tasks or deciding when to pause work.

## How it works

The orchestrator periodically polls usage APIs for all configured agents (Claude, Codex, Gemini) and exposes a unified endpoint. Usage data is only available for agents authenticated via OAuth (subscription accounts). API key-based agents show no usage data.

## API Reference

### Get usage status

\`\`\`bash
curl "$ORCHESTRATOR_URL/api/usage"
\`\`\`

Returns a JSON object with per-agent usage information:

\`\`\`json
{
  "agents": [
    {
      "agentId": "claude",
      "displayName": "Claude",
      "authType": "oauth",
      "usageAvailable": true,
      "windows": [
        {
          "label": "Session",
          "utilization": 45.2,
          "resetsAt": "2025-01-15T12:00:00Z"
        }
      ]
    }
  ]
}
\`\`\`

**What the fields mean:**
- \`agentId\` — Which agent (claude, codex, gemini)
- \`authType\` — How the agent authenticates: \`"oauth"\` (subscription), \`"api-key"\`, or \`"none"\`
- \`usageAvailable\` — Whether usage data could be retrieved. \`false\` for API key auth or when the token is expired
- \`windows[]\` — Usage windows, each with:
  - \`label\` — Window name (e.g. "Session", "Weekly")
  - \`utilization\` — Percentage used, 0-100. Over 80% means you're close to hitting limits
  - \`resetsAt\` — ISO 8601 timestamp when the window resets

## When to check

- Before starting a large task that will consume significant quota
- When you're getting rate-limited or experiencing slow responses
- To decide whether to continue working or wait for a quota reset
`,
  },
];

export const BUILT_IN_INSTRUCTIONS: BuiltInInstruction[] = [
  {
    id: 'builtin-platform-guide',
    name: 'Platform Guide',
    content: `# Agentor Platform Guide

## What is Agentor?

Agentor is a platform for running AI coding agents in isolated Docker containers called **workers**. A human operator uses the Agentor web dashboard to create workers, configure their environments, and monitor their activity. You — the AI agent — run inside one of these workers.

## Architecture overview

There are four components in the platform:

- **Orchestrator** — The central server. It provides the web dashboard, manages all workers, and exposes a REST API. It runs as a Docker container (\`agentor-orchestrator\`) on the same network as your worker.
- **Workers** — Isolated Ubuntu containers where agents run. Each worker has its own filesystem, network stack, and persistent workspace. You are running inside a worker right now.
- **Port Mapper** — An optional proxy container that forwards host ports to internal worker ports. It is managed by the orchestrator and created automatically when port mappings are configured. This is how services running inside workers (like dev servers) become accessible from outside.
- **Traefik** — An optional reverse proxy that maps domain names to worker ports with automatic TLS. It is managed by the orchestrator and created when domain mappings are configured. This is how workers can serve traffic on proper domain names.

You can interact with the orchestrator's API from inside your worker to manage port mappings, domain mappings, and check usage quotas — if these capabilities have been enabled for your environment. Skills for these APIs may be available to you.

## Your worker environment

### System

- **OS:** Ubuntu 24.04 LTS
- **User:** \`agent\` (uid 1000) with passwordless sudo
- **Shell:** bash
- **Workspace:** \`/workspace\` — this is your main working directory. It is stored on a persistent Docker volume that survives container restarts and even archiving/unarchiving of the worker. Always work here.
- **Home:** \`/home/agent\`

### Installed tools

- **Languages:** Node.js 22 LTS (npm, npx), Python 3 (pip), build-essential (gcc, make)
- **Editors:** neovim, vim, nano
- **VCS:** git, gh (GitHub CLI)
- **Search:** ripgrep (rg), fd-find (fd)
- **Utilities:** jq, curl, wget, tree, less, htop, btop, rsync, strace, file, man-db
- **Network:** openssh-client, dnsutils, net-tools, iputils-ping

### Display and browsers

A virtual display is running (Xvfb on \`:99\` with fluxbox). Set \`DISPLAY=:99\` to launch graphical applications. Chromium and Playwright (with bundled Chromium and Firefox) are available for browser automation. VS Code (code-server) is available in the browser via the orchestrator dashboard.

### Docker-in-Docker

If Docker is enabled for this environment (\`DOCKER_ENABLED=true\`), a Docker daemon runs inside this container. The \`agent\` user is in the \`docker\` group — no sudo needed. Docker Compose, BuildKit, and all standard Docker features work natively. Docker data persists across container restarts.

### Network access

Network access depends on your environment's configuration. Some environments allow full internet access, others restrict outbound connections to specific domains using a DNS-based firewall. Regardless of the firewall mode, the orchestrator and other containers on the Docker network are always reachable.

### Key environment variables

- \`ORCHESTRATOR_URL\` — Base URL of the orchestrator API (e.g. \`http://agentor-orchestrator:3000\`)
- \`WORKER_CONTAINER_NAME\` — This worker container's name, used to identify yourself when calling orchestrator APIs
- \`DOCKER_ENABLED\` — \`true\` if Docker-in-Docker is available
- \`DISPLAY\` — X11 display (\`:99\`)
`,
  },
];
