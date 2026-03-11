# Key Files

## Root
- `.env.example` - All environment variables with descriptions and defaults
- `.cred.example/` - Template credential files for OAuth/subscription auth (claude.json, codex.json, gemini.json, README)
- `docker-compose.prod.yml` - Production Docker Compose configuration (GHCR images)
- `docker-compose.dev.yml` - Development Docker Compose (hot reload via mounted source)
- `.github/workflows/docker-build.yml` - CI: multi-arch image builds for all components

## Mapper
- `mapper/Dockerfile` - Minimal Node.js Alpine image for the port mapper container
- `mapper/proxy.mjs` - Standalone TCP proxy script (reads /data/port-mappings.json)

## Orchestrator — Config
- `orchestrator/app.config.ts` - App-level configuration

## Orchestrator — Shared
- `orchestrator/shared/types.ts` - Shared TypeScript interfaces used by both server and client (RepoConfig, MountConfig, TmuxWindow, AppInstanceInfo, NetworkMode, ServiceStatus, ContainerInfo, ContainerStatus, CreateContainerRequest, ImageUpdateInfo, UpdateStatus, ApplyResult, PruneResult, AgentAuthType, UsageWindow, AgentUsageInfo, AgentUsageStatus, ExposeApis, SkillInfo, AgentsMdEntryInfo, InitScriptInfo, CredentialInfo, UpdatableImage, LogLevel, LogSource, LogEntry)

## Orchestrator — Server
- `orchestrator/Dockerfile` - Multi-stage Node 22 Alpine build
- `orchestrator/nuxt.config.ts` - Nuxt configuration (modules, SPA mode, Nitro WebSocket)
- `orchestrator/server/plugins/services.ts` - Nitro startup: init Logger + LogStore + LogBroadcaster + LogCollector + Docker + ContainerManager + PortMappingStore + MapperManager + DomainMappingStore + TraefikManager + EnvironmentStore + SkillStore + AgentsMdStore + InitScriptStore + WorkerStore + UpdateChecker + UsageChecker
- `orchestrator/server/utils/config.ts` - Environment variable parsing
- `orchestrator/server/utils/init-script-store.ts` - InitScriptStore class (extends JsonStore, built-in seeding)
- `orchestrator/server/utils/agent-config.ts` - Static agent configuration registry (API domains, env var mappings per agent)
- `orchestrator/server/utils/git-providers.ts` - Git provider registry (GIT_PROVIDER_REGISTRY)
- `orchestrator/server/utils/apps.ts` - App type registry (APP_REGISTRY)
- `orchestrator/server/utils/json-store.ts` - Generic JsonStore<K, V> base class (Map + JSON file + saveQueue pattern)
- `orchestrator/server/utils/docker.ts` - DockerService class (dockerode wrapper)
- `orchestrator/server/utils/container.ts` - ContainerManager class (container lifecycle, archive/unarchive)
- `orchestrator/server/utils/port-mapping-store.ts` - PortMappingStore class (extends JsonStore)
- `orchestrator/server/utils/mapper-manager.ts` - MapperManager class (mapper container lifecycle via dockerode)
- `orchestrator/server/utils/domain-mapping-store.ts` - DomainMappingStore class (persistent domain mappings)
- `orchestrator/server/utils/traefik-manager.ts` - TraefikManager class (Traefik container lifecycle, dynamic config generation)
- `orchestrator/server/utils/update-checker.ts` - UpdateChecker class (GHCR digest polling, image pull, orchestrator self-replacement)
- `orchestrator/server/utils/usage-checker.ts` - UsageChecker class (agent usage API polling, OAuth token refresh for Codex)
- `orchestrator/server/utils/environments.ts` - EnvironmentStore class, network mode types, package manager domains list
- `orchestrator/server/utils/worker-store.ts` - WorkerStore class (persistent worker metadata for archive/unarchive)
- `orchestrator/server/utils/credential-mounts.ts` - CredentialMountManager class (resolves host path of /cred mount, generates bind mount strings for worker containers) + AGENT_CREDENTIAL_MAPPINGS registry
- `orchestrator/server/utils/storage.ts` - StorageManager class (auto-detects volume vs directory storage mode, provides bind string construction and cleanup for worker workspaces, DinD, Traefik certs)
- `orchestrator/server/utils/selfsigned-certs.ts` - SelfSignedCertManager class (CA + wildcard cert generation using node-forge for selfsigned domains)
- `orchestrator/server/utils/skill-store.ts` - SkillStore class (extends JsonStore, built-in seeding)
- `orchestrator/server/utils/agents-md-store.ts` - AgentsMdStore class (AGENTS.md entries, extends JsonStore, built-in seeding)
- `orchestrator/server/utils/built-in-content.ts` - Built-in content loader (reads markdown files from server assets via `useStorage()`)
- `orchestrator/server/built-in/skills/` - Built-in skill markdown files (filename = ID, content = skill markdown with YAML frontmatter)
- `orchestrator/server/built-in/agents-md/` - Built-in AGENTS.md entry files (filename = ID, name parsed from first `# Heading`)
- `orchestrator/server/built-in/init-scripts/` - Built-in init script files (plain .sh, filename = ID and name)
- `orchestrator/server/built-in/environments/` - Built-in environment JSON files (filename = ID, contains environment config)
- `orchestrator/server/utils/logger.ts` - Logger class (replaces console.log/warn/error, buffers during startup, writes to LogStore + LogBroadcaster)
- `orchestrator/server/utils/log-store.ts` - LogStore class (NDJSON file storage with size-based rotation, query with filters)
- `orchestrator/server/utils/log-broadcaster.ts` - LogBroadcaster class (manages WebSocket peers for live log streaming)
- `orchestrator/server/utils/log-collector.ts` - LogCollector class (attaches to Docker containers via dockerode logs, handles TTY/non-TTY streams, heuristic level detection)
- `orchestrator/server/utils/log-levels.ts` - Log level utilities (shouldLog, parseLogLevel)
- `orchestrator/server/utils/services.ts` - Singleton getters via `singleton()` factory (useDockerService, useContainerManager, useConfig, usePortMappingStore, useMapperManager, useDomainMappingStore, useSelfSignedCertManager, useTraefikManager, useGitHubService, useEnvironmentStore, useWorkerStore, useStorageManager, useUpdateChecker, useUsageChecker, useCredentialMountManager, useSkillStore, useAgentsMdStore, useInitScriptStore, useLogStore, useLogBroadcaster, useLogger, useLogCollector) + shared `cleanupWorkerMappings()` utility
- `orchestrator/server/utils/validation.ts` - Shared validation constants (WINDOW_NAME_RE)
- `orchestrator/server/utils/ws-utils.ts` - Shared WebSocket utilities (getPeerId, toBuffer, createWsRelayHandlers factory for desktop/editor relays)
- `orchestrator/server/utils/terminal-handler.ts` - Docker stream WebSocket terminal logic (uses ws-utils, exports terminalWsHandler)
- `orchestrator/server/utils/github.ts` - GitHubService class (GitHub API wrapper, repo/branch operations)
- `orchestrator/server/api/logs.get.ts` - Query log entries with filters (sources, levels, search, since, until, limit)
- `orchestrator/server/api/logs.delete.ts` - Clear all log files
- `orchestrator/server/api/log-sources.get.ts` - List known container log sources
- `orchestrator/server/api/` - REST API routes (file-based, JSON only)
- `orchestrator/server/routes/desktop/` - HTTP reverse proxy for noVNC static files (per-container)
- `orchestrator/server/routes/editor/` - Combined HTTP+WS proxy for code-server (per-container, h3 combined handler + ws-utils relay)
- `orchestrator/server/routes/ws/desktop/` - WebSocket relay for VNC protocol (per-container, crossws + ws)
- `orchestrator/server/routes/ws/logs.ts` - WebSocket live log stream (crossws, read-only)
- `orchestrator/server/routes/ws/terminal/` - WebSocket terminal routes (crossws)

## Orchestrator — Client (app/)
- `orchestrator/app/assets/css/main.css` - CSS custom properties for theming (--pane-tab-*, --terminal-*, --scrollbar-*) + dark/light mode overrides
- `orchestrator/app/app.vue` - Nuxt app root component
- `orchestrator/app/pages/index.vue` - Dashboard page (sidebar + split pane layout + modals)
- `orchestrator/app/plugins/xterm.client.ts` - Provides `$Terminal` and `$FitAddon` globally (avoids SSR import issues)
- `orchestrator/app/components/AppSidebar.vue` - Left sidebar (container list, archived workers, port mappings, domain mappings, usage panel, update notification)
- `orchestrator/app/components/AppInstanceRow.vue` - Single app row in AppsPane
- `orchestrator/app/components/AppsPane.vue` - App instances for a container
- `orchestrator/app/components/ArchivedWorkerCard.vue` - Archived worker card in sidebar
- `orchestrator/app/components/ContainerCard.vue` - Worker card (controls, upload/download, archive, detail modal)
- `orchestrator/app/components/ContainerDetailModal.vue` - Detail modal (auto-displays all `agentor.*` Docker labels)
- `orchestrator/app/components/CreateContainerModal.vue` - New worker modal (environment selector, init preset, repos)
- `orchestrator/app/components/ServicePane.vue` - Unified iframe pane for desktop (noVNC) and editor (code-server)
- `orchestrator/app/components/DomainMappingsPanel.vue` - Domain mapping CRUD panel (subdomain, protocol, basic auth)
- `orchestrator/app/components/EnvironmentEditor.vue` - Environment form (resources, network, Docker, expose APIs, skills, AGENTS.md, scripts)
- `orchestrator/app/components/EnvironmentsModal.vue` - Environment list + editor (CRUD)
- `orchestrator/app/components/SkillsModal.vue` - Skills management modal (list, view built-in, create/edit/delete custom)
- `orchestrator/app/components/AgentsMdModal.vue` - AGENTS.md entries management modal (same pattern as SkillsModal)
- `orchestrator/app/components/InitScriptsModal.vue` - Init scripts management modal (list, view built-in, create/edit/delete custom)
- `orchestrator/app/components/SettingsModal.vue` - System settings viewer (auto-renders categorized sections from `/api/settings`)
- `orchestrator/app/components/FileDropZone.vue` - Drag-and-drop file zone for uploads
- `orchestrator/app/components/MountInput.vue` - Form input for a single host bind-mount config
- `orchestrator/app/components/LogPane.vue` - Log viewer pane (filter bar, color-coded entries, auto-scroll, WebSocket live stream)
- `orchestrator/app/components/PaneContent.vue` - Renders active tab content (Terminal/Desktop/Editor/Apps/Logs/Placeholder)
- `orchestrator/app/components/PaneDropOverlay.vue` - 5-zone drop overlay during tab drag (left/right/top/bottom/center)
- `orchestrator/app/components/PaneGroupTabBar.vue` - Per-leaf tab bar (HTML5 draggable tabs, drop target)
- `orchestrator/app/components/PaneSeparator.vue` - Resizable separator between pane nodes (horizontal or vertical)
- `orchestrator/app/components/PaneSplitNode.vue` - Recursive component rendering PaneNode tree (leaf → tab bar + content, container → flex children + separators)
- `orchestrator/app/components/PortMappingsPanel.vue` - Port mappings management
- `orchestrator/app/components/RepoInput.vue` - Repo URL + branch + provider input with GitHub repo/branch search
- `orchestrator/app/components/SplitPaneLayout.vue` - Thin wrapper rendering PaneSplitNode at rootNode
- `orchestrator/app/components/TerminalPane.vue` - Multi-terminal host with inner tmux tab bar (TmuxTabBar)
- `orchestrator/app/components/TerminalPlaceholder.vue` - Empty state when no worker is open
- `orchestrator/app/components/ThemeToggle.vue` - Three-way color mode toggle (Default/White/Dark)
- `orchestrator/app/components/TmuxTabBar.vue` - Inner tmux window tab bar
- `orchestrator/app/components/UpdateNotification.vue` - Sidebar update notification (image digests, one-click update)
- `orchestrator/app/components/UsagePanel.vue` - Agent usage monitoring panel (progress bars, auth badges, reset times)
- `orchestrator/app/components/UploadModal.vue` - Modal for workspace file uploads
- `orchestrator/app/composables/useApps.ts` - App CRUD + polling
- `orchestrator/app/composables/useArchivedWorkers.ts` - Archived workers list + polling
- `orchestrator/app/composables/useContainers.ts` - Container CRUD + polling
- `orchestrator/app/composables/useContainerServiceStatus.ts` - Service status polling (5s) for desktop/editor
- `orchestrator/app/composables/useDomainMappings.ts` - Domain mapping CRUD + polling
- `orchestrator/app/composables/useInitScriptSync.ts` - Bidirectional sync between init script dropdown and init script textarea
- `orchestrator/app/composables/useDragTab.ts` - Tab drag-and-drop (HTML5 DnD)
- `orchestrator/app/composables/useEnvironments.ts` - Environment CRUD
- `orchestrator/app/composables/useSkills.ts` - Skill CRUD
- `orchestrator/app/composables/useAgentsMd.ts` - AGENTS.md entry CRUD
- `orchestrator/app/composables/useGitHubRepos.ts` - GitHub repos list, org filter, create repo
- `orchestrator/app/composables/useGitProviders.ts` - Git provider list
- `orchestrator/app/composables/useInitScripts.ts` - Init script CRUD
- `orchestrator/app/composables/usePolling.ts` - Polling lifecycle helper (start/stop with onMounted/onUnmounted)
- `orchestrator/app/composables/usePortMappings.ts` - Port mapping CRUD + polling
- `orchestrator/app/composables/useSidebarResize.ts` - Sidebar drag-to-resize
- `orchestrator/app/composables/useSplitPanes.ts` - Pane state manager (tab CRUD, split/merge, resize, persisted)
- `orchestrator/app/composables/useUiState.ts` - Unified UI state persistence (single localStorage key, debounced writes)
- `orchestrator/app/composables/useTerminal.ts` - xterm.js lifecycle + WebSocket (manually managed with `destroy()`)
- `orchestrator/app/composables/useTmuxTabs.ts` - Tmux window management (fetch, poll, create, close, activate, rename)
- `orchestrator/app/composables/useLogs.ts` - Log entry state, WebSocket connection, history fetch, client-side filtering
- `orchestrator/app/composables/useUpdates.ts` - Update status polling + apply (production mode only)
- `orchestrator/app/composables/useUsage.ts` - Agent usage status polling (60s)
- `orchestrator/app/utils/container-name.ts` - Utility for container name display (shortName helper)
- `orchestrator/app/types/index.ts` - Client-side TypeScript types: re-exports shared types (including AgentAuthType, UsageWindow, AgentUsageInfo, AgentUsageStatus, ExposeApis, SkillInfo, AgentsMdEntryInfo, InitScriptInfo, CredentialInfo, LogLevel, LogSource, LogEntry) + defines GitProviderInfo, GitHubRepoInfo, GitHubBranchInfo, AppTypeInfo, PortMapping, DomainMapping, DomainMapperStatus, EnvironmentInfo, OrchestratorEnvVar, ArchivedWorker, TabType, Tab, SplitDirection, PaneLeafNode, PaneContainerNode, PaneNode, DragPayload, DropZone, ChallengeType, BaseDomainConfig

## Worker
- `worker/Dockerfile` - Unified worker image (Node.js 22, all agent CLIs, code-server, display stack, Chromium, Playwright, Firefox, microsocks, utility packages, agent user, entrypoint)
- `worker/entrypoint.sh` - Entrypoint (tmux, env var export, agent setups, docker daemon, display stack, code-server, git auth, repo clone, firewall, setup script, launch)
- `worker/loading-screen.sh` - Animated startup display (braille spinner, progress bar, per-step timing)
- `worker/memfd-exec.py` - Script executor via memfd_create (no temp files on disk, supports any shebang)
- `worker/setup.sh` - Runs ENVIRONMENT.setupScript via memfd (called by entrypoint Phase 7)
- `worker/init.sh` - Runs WORKER.initScript via memfd or falls back to bash (tmux pane command)
- `worker/git-wrapper.sh` - Process-tree-aware git identity wrapper (installed at /usr/local/bin/git)
- `worker/apps/chromium/manage.sh` - Chromium app manager (start/stop/list via docker exec)
- `worker/apps/socks5/manage.sh` - SOCKS5 proxy app manager
- `worker/agents/claude/setup.sh` - Claude auth + config + skills/AGENTS.md writing (reads SKILLS/AGENTS_MD JSON env vars)
- `worker/agents/codex/setup.sh` - Codex auth + config + skills/AGENTS.md writing
- `worker/agents/gemini/setup.sh` - Gemini auth + config + skills/AGENTS.md writing
- `worker/agents/*/git-identity` - Per-agent git identity (two lines: name, email)

## Tests
- `tests/playwright.config.ts` - Playwright config (two projects: api + ui, parallel workers, timeouts)
- `tests/helpers/api-client.ts` - Typed API wrapper for all endpoints (returns `{ status, body }`)
- `tests/helpers/worker-lifecycle.ts` - Container create/cleanup helpers with timeouts
- `tests/helpers/terminal-ws.ts` - WebSocket terminal client with ANSI stripping
- `tests/helpers/ui-helpers.ts` - Page navigation and interaction helpers
- `tests/api/*.spec.ts` - API integration tests (32 files)
- `tests/ui/*.spec.ts` - UI integration tests (37 files)
- `tests/FEATURES.md` - Feature inventory driving test coverage
- `tests/TESTS.md` - Test suite documentation with counts per file
