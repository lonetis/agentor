# Environments, Skills & AGENTS.md

## Environment System

Environments bundle per-worker configuration: CPU/memory limits, network access policy, Docker-in-Docker toggle, custom env vars, setup script (pre-agent), API exposure flags, and skill/AGENTS.md selections. The init script (which agent to launch) is configured per-worker at creation time via the Create Worker modal, not in environments. Managed via `orchestrator/server/utils/environments.ts` (`EnvironmentStore`), stored as JSON in `<DATA_DIR>/environments.json`. Follows the built-in store pattern: a built-in `default.json` file in `orchestrator/server/built-in/environments/` defines the default environment, `EnvironmentStore` has a `builtIn` field and `seedBuiltIns()` method (same pattern as skills, agents-md, and init-scripts). Built-in environments cannot be edited or deleted, but their content is updated on startup.

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

## Skills

Reusable knowledge documents teaching agents how to use specific capabilities, following the [Agent Skills specification](https://agentskills.io/specification). Each skill is a markdown file with YAML frontmatter (`name`, `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`). Managed via `orchestrator/server/utils/skill-store.ts` (`SkillStore`), persisted to `<DATA_DIR>/skills.json`. Built-in skill files live in `orchestrator/server/built-in/skills/`.

**Built-in skills (4):**
- `port-mapping` — Documents port mapping API (auto-filtered when `exposeApis.portMappings` is false)
- `domain-mapping` — Documents domain mapping API (auto-filtered when `exposeApis.domainMappings` is false)
- `usage` — Documents usage monitoring API (auto-filtered when `exposeApis.usage` is false)
- `tmux` — Documents tmux session/window/pane management inside workers (always included, no API filter)

Custom skills can be created via the Skills modal in the sidebar. Built-in skills cannot be edited or deleted, but their content is updated on startup.

Skills are written to agent-specific paths on container first startup:
- Claude: `/home/agent/.claude/skills/agentor-<safe-name>/SKILL.md` (with YAML frontmatter)
- Codex: `/home/agent/.agents/skills/agentor-<safe-name>/SKILL.md` (with YAML frontmatter)
- Gemini: `/home/agent/.gemini/commands/agentor-<safe-name>.toml`

## AGENTS.md

Platform context documents following the [AGENTS.md standard](https://agents.md/) — a dedicated, predictable place to provide context and instructions to help AI coding agents work on a project. Managed via `orchestrator/server/utils/agents-md-store.ts` (`AgentsMdStore`), persisted to `<DATA_DIR>/agents-md.json`. Built-in AGENTS.md files live in `orchestrator/server/built-in/agents-md/`. The entry name is parsed from the first `# Heading` in the markdown.

**Built-in entry (1):**
- `platform-guide` — Comprehensive worker environment description (OS, tools, display stack, Docker, orchestrator API, etc.)

AGENTS.md entries are merged into a single markdown document and written to:
- Claude: `/home/agent/.claude/CLAUDE.md`
- Codex: `/home/agent/.codex/AGENTS.md`
- Gemini: `/home/agent/.gemini/GEMINI.md`

## Environment Integration

Both skills and AGENTS.md entries are selected per-environment:
- `exposeApis: { portMappings, domainMappings, usage }` — Controls which API skills are included (default all true)
- `enabledSkillIds: string[] | null` — `null` = all, `[]` = none, or specific IDs
- `enabledAgentsMdIds: string[] | null` — Same semantics

## Worker API Exposure

Workers can call orchestrator APIs over the Docker network. The orchestrator passes these env vars to every worker:
- `ORCHESTRATOR_URL=http://agentor-orchestrator:3000`
- `WORKER_CONTAINER_NAME=<container-name>`
- `EXPOSE_PORT_MAPPINGS`, `EXPOSE_DOMAIN_MAPPINGS`, `EXPOSE_USAGE` — exported by the entrypoint from `ENVIRONMENT.exposeApis`

Port mapping and domain mapping create endpoints also accept `workerName` as an alternative to `workerId`, so agents can use `$WORKER_CONTAINER_NAME` directly.

No firewall changes needed — the orchestrator is on the same Docker bridge network (`agentor-net`), and existing firewall rules allow private network ranges.

Platform setup (skills + AGENTS.md writing) runs only on first container startup (sentinel file `/home/agent/.agentor-platform-init`), handled by each agent's `setup.sh`. On restart, user modifications to skill/AGENTS.md files are preserved.
