# Environments, Capabilities & Instructions

## Environment System

Environments bundle per-worker configuration: CPU/memory limits, network access policy, Docker-in-Docker toggle, custom env vars, setup script (pre-agent), API exposure flags, and capability/instruction selections. The init script (which agent to launch) is configured per-worker at creation time via the Create Worker modal, not in environments. Managed via `orchestrator/server/utils/environments.ts` (`EnvironmentStore`), stored as JSON in `<DATA_DIR>/environments.json`. Follows the built-in store pattern: a built-in `default.json` file in `orchestrator/server/built-in/environments/` defines the default environment, `EnvironmentStore` has a `builtIn` field and `seedBuiltIns()` method (same pattern as capabilities, instructions, and init-scripts). Built-in environments cannot be edited or deleted, but their content is updated on startup.

### Network Firewall

Uses **dnsmasq + ipset + iptables** for network-level domain filtering (not a bypassable proxy):

| Mode | Behavior |
|------|----------|
| `full` | No restrictions (default, backward compatible) |
| `block` | iptables OUTPUT DROP — only agent API domains allowed |
| `block-all` | iptables OUTPUT DROP — all outbound blocked, no exceptions |
| `package-managers` | dnsmasq + ipset allowlist of 98 package registry domains + agent API domains |
| `custom` | dnsmasq + ipset with user-defined domains (+ optional PM domains) + agent API domains |

**Agent API domains** (aggregated from `AGENT_CONFIGS` in `agent-config.ts`) are always injected into every restricted mode so any agent CLI can reach its model API, auth, and telemetry endpoints. The UI shows all agent domains in a collapsible section when a restricted mode is selected.

Architecture: dnsmasq resolves allowed domains and adds IPs to a kernel ipset via `ipset=` directives. iptables OUTPUT policy is DROP, with exceptions for loopback, Docker networks, and the ipset. Blocks all protocols (TCP/UDP/ICMP) to non-allowed destinations.

## Capabilities

Reusable knowledge documents teaching agents how to use specific capabilities, following the [Agent Skills specification](https://agentskills.io/specification). Each capability is a markdown file with YAML frontmatter (`name`, `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`). Managed via `orchestrator/server/utils/capability-store.ts` (`CapabilityStore`), persisted to `<DATA_DIR>/capabilities.json`. Built-in capability files live in `orchestrator/server/built-in/capabilities/`.

**Built-in capabilities (4):**
- `port-mapping` — Documents the worker-self port mapping API at `/api/worker-self/port-mappings` (auto-filtered when `exposeApis.portMappings` is false)
- `domain-mapping` — Documents the worker-self domain mapping API at `/api/worker-self/domain-mappings` (auto-filtered when `exposeApis.domainMappings` is false)
- `usage` — Documents the worker-self usage monitoring API at `/api/worker-self/usage` (auto-filtered when `exposeApis.usage` is false)
- `tmux` — Documents tmux session/window/pane management inside workers (always included, no API filter)

Custom capabilities can be created via the Capabilities modal in the sidebar. Built-in capabilities cannot be edited or deleted, but their content is updated on startup.

Capabilities are written to agent-specific paths on container first startup:
- Claude: `/home/agent/.claude/skills/agentor-<safe-name>/SKILL.md` (with YAML frontmatter)
- Codex: `/home/agent/.agents/skills/agentor-<safe-name>/SKILL.md` (with YAML frontmatter)
- Gemini: `/home/agent/.gemini/commands/agentor-<safe-name>.toml`

## Instructions

Platform context documents following the [AGENTS.md standard](https://agents.md/) — a dedicated, predictable place to provide context and instructions to help AI coding agents work on a project. Managed via `orchestrator/server/utils/instruction-store.ts` (`InstructionStore`), persisted to `<DATA_DIR>/instructions.json`. Built-in instruction files live in `orchestrator/server/built-in/instructions/`. The entry name is parsed from the first `# Heading` in the markdown.

**Built-in entry (1):**
- `platform-guide` — Comprehensive worker environment description (OS, tools, display stack, Docker, orchestrator API, etc.)

Instruction entries are merged into a single markdown document and written to:
- Claude: `/home/agent/.claude/CLAUDE.md`
- Codex: `/home/agent/.codex/AGENTS.md`
- Gemini: `/home/agent/.gemini/GEMINI.md`

## Environment Integration

Both capabilities and instructions are selected per-environment:
- `exposeApis: { portMappings, domainMappings, usage }` — Controls which API capabilities are included (default all true)
- `enabledCapabilityIds: string[] | null` — `null` = all, `[]` = none, or specific IDs
- `enabledInstructionIds: string[] | null` — Same semantics

## Worker API Exposure

Workers can call orchestrator APIs over the Docker network. The orchestrator passes these env vars to every worker:
- `ORCHESTRATOR_URL=http://agentor-orchestrator:3000`
- `WORKER_CONTAINER_NAME=<container-name>` (kept for diagnostics — the worker-self routes do not need it)
- `EXPOSE_PORT_MAPPINGS`, `EXPOSE_DOMAIN_MAPPINGS`, `EXPOSE_USAGE` — exported by the entrypoint from `ENVIRONMENT.exposeApis`

### Worker-self routes (the canonical worker entry point)

Workers call dedicated `/api/worker-self/*` routes. These are listed in the global `PUBLIC_API_PREFIXES` in `server/middleware/auth.ts`, so they bypass the session-cookie check entirely. Instead, each handler calls `requireWorkerSelf(event)` (`server/utils/worker-auth.ts`), which:

1. Reads the source IP from `event.node.req.socket.remoteAddress` (stripping any `::ffff:` IPv4-mapped prefix).
2. Lists managed Docker containers (filtered by `agentor.managed=true`) and matches each container's IP on the configured `dockerNetwork` (default `agentor-net`) against the source IP. The IP→containerName map is cached for 3 seconds; misses force a refresh.
3. Resolves the matched `containerName` back to a `ContainerInfo` via `containerManager.findByContainerName()`. If the container is not in `running` state, returns 409.
4. Returns `{ container, userId, containerName, workerName }` — the handler uses these to scope the operation to the calling worker.

Available routes:
- `GET  /api/worker-self/info` — diagnostics (`{ workerName, containerName, userId, status, displayName }`)
- `GET  /api/worker-self/port-mapper/status`
- `GET  /api/worker-self/port-mappings` — only mappings owned by the calling worker
- `POST /api/worker-self/port-mappings` — `workerId` / `workerName` body fields are not accepted; the calling worker is the target
- `DELETE /api/worker-self/port-mappings/:port` — refuses (403) if the mapping belongs to a different worker
- `GET  /api/worker-self/domain-mapper/status`
- `GET  /api/worker-self/domain-mappings` — only mappings owned by the calling worker
- `POST /api/worker-self/domain-mappings`
- `POST /api/worker-self/domain-mappings/batch`
- `DELETE /api/worker-self/domain-mappings/:id`
- `GET  /api/worker-self/usage` — scoped to the worker's owning userId
- `POST /api/worker-self/usage/refresh`

The session-authenticated `/api/port-mappings`, `/api/domain-mappings`, and `/api/usage` routes still exist for the dashboard UI but are not reachable from inside a worker (no session cookie). All worker-side capability docs reference the `/api/worker-self/*` form exclusively.

No firewall changes needed — the orchestrator is on the same Docker bridge network (`agentor-net`), and existing firewall rules allow private network ranges.

Platform setup (capabilities + instructions writing) runs only on first container startup (sentinel file `/home/agent/.agentor-platform-init`), handled by each agent's `setup.sh`. On restart, user modifications to capability/instruction files are preserved.
