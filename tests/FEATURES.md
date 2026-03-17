# Agentor — Comprehensive Feature List

Every user-facing feature of the Agentor web dashboard, organized by category. This document drives the Playwright test suite — every item below must have test coverage.

---

## 1. Dashboard Layout

### 1.1 Page Structure
- Page loads with "Agentor" title and "Orchestrator" subtitle
- Browser title contains "Agentor"
- Left sidebar + main content area layout
- Main content area shows placeholder when no panes are open ("Create a worker from the sidebar to get started")
- Floating hamburger button appears when sidebar is collapsed

### 1.2 Sidebar Header
- "Agentor" heading with "Orchestrator" subtitle
- ThemeToggle component (3 buttons: System/Light/Dark)
- Collapse sidebar button (double-chevron icon)

### 1.3 Sidebar Action Buttons
- "+ New Worker" button opens create worker modal
- "Environments" button opens environments modal
- "Skills" button opens skills modal
- "AGENTS.md" button opens AGENTS.md modal
- "Init Scripts" button opens init scripts modal

### 1.4 Sidebar Sections (all collapsible with chevron toggle)
- **Workers** — list of active container cards
- **Archived** — collapsed by default, only shown when archived workers exist, shows count
- **Port Mappings** — always visible
- **Domain Mappings** — only visible when domain mapper is enabled (BASE_DOMAINS configured)
- **Usage** — always visible, has refresh button
- **Images** — always visible
- **Settings** — always visible, contains "Logs" button, "System Settings" button, and "API Docs" link

---

## 2. Sidebar Resize & Collapse

### 2.1 Resize
- Drag handle at right edge of sidebar
- Width range: 200–700px, clamped
- Width persisted to localStorage

### 2.2 Collapse/Expand
- Collapse button (double-chevron) hides sidebar
- Expand button (floating) restores sidebar
- Collapse state persisted to localStorage across reloads
- Mobile auto-collapse at <768px viewport (transient, not persisted)
- Mobile: sidebar overlays as fixed panel with backdrop; clicking backdrop closes sidebar

### 2.3 Panel Collapse States
- Each panel section (Archived, Port Mappings, Domain Mappings, Usage, Images, Settings) independently collapsible
- Panel states persisted to localStorage
- Panel re-expand persists across reload
- Multiple panel states persist independently

---

## 3. Theme System

### 3.1 Toggle
- Three-way toggle: Default (system), White (light), Dark (dark)
- Icons: monitor (default), sun (light), moon (dark)
- Active button highlighted with shadow
- Default preference: dark

### 3.2 Persistence
- Theme preference persisted across reloads via @nuxtjs/color-mode
- Terminal themes switch reactively (DARK_THEME / LIGHT_THEME)
- CSS custom properties for pane tabs, terminal area, scrollbars

---

## 4. Container Cards (Worker Cards in Sidebar)

### 4.1 Card Content
- Display name (truncated with title tooltip)
- Status badge: running (green), stopped (neutral), creating (warning), error (error), removing (warning)
- Short image ID in monospace (first 10 chars)
- Active card: blue-tinted background with blue border and shadow
- Clicking name/status area opens detail modal

### 4.2 View Buttons (only when running)
- Terminal button (tooltip "Terminal") — opens terminal pane
- Desktop button (tooltip "Desktop") — opens desktop pane
- Editor button (tooltip "Editor") — opens editor pane
- Apps button (tooltip "Apps") — opens apps pane
- Upload button (tooltip) — opens upload modal
- Download button (tooltip) — downloads workspace as .tar.gz

### 4.3 Action Buttons
- "Stop" — visible when running, stops the container
- "Restart" — visible when stopped, restarts the container
- "Rebuild" — always visible, destroys and recreates container with latest image (confirm dialog, preserves workspace)
- "Archive" — always visible, archives with confirm dialog
- "Remove" — always visible, removes with confirm dialog

### 4.4 State Transitions
- Running → stopped: Stop button click
- Stopped → running: Restart button click
- Running/stopped → archived: Archive button click (confirm dialog)
- Any → removed: Remove button click (confirm dialog)
- Icon buttons hidden when stopped

---

## 5. Container Detail Modal

### 5.1 Content
- Header: container display name + status badge (color-coded)
- Worker info: Container name, Container ID (first 12 chars), Image, Image ID (first 12 chars), Created timestamp
- Configuration section (conditional): Environment name, CPU limit, Memory limit, Network mode (if non-full), Docker enabled
- Repositories section (conditional): repo URLs in monospace + optional branch with "@" prefix

### 5.2 Interactions
- Opens when clicking container name/status
- Close via Escape key
- Close via clicking overlay

---

## 6. Create Worker Modal

### 6.1 Form Fields
- **Name** — text input, auto-generated placeholder (fetched from API), sanitized to lowercase/alphanumeric/hyphens
- **Environment** — dropdown selector with "Default" option + "Manage" button (opens environments modal)
- **Repositories** — dynamic list with "+ Add repository" link, each row has RepoInput + remove button
- **Volume Mounts** — dynamic list with "+ Add mount" link, each row has MountInput (source, target, read-only checkbox) + remove button
- **Init Script** — preset dropdown (None, claude, codex, gemini, custom scripts) + "Manage" button (opens init scripts modal) + editable textarea (3 rows, monospace)

### 6.2 Init Script Sync
- Selecting a preset populates the textarea
- Editing textarea to match a preset auto-selects it
- Clearing textarea switches to "None"
- Any other edit switches to "Custom"

### 6.3 Repository Input Features
- Git provider dropdown (GitHub, etc.)
- When GitHub token configured: searchable dropdown with repos, keyboard navigation (ArrowUp/Down/Enter/Escape)
- Create new repo from dropdown (public or private)
- Branch selector (auto-loaded from GitHub API, shows default branch as placeholder)
- Without token: plain text URL input + plain branch input

### 6.4 Actions
- "Create" button — validates, creates container, auto-opens terminal tab, closes modal, resets form
- "Cancel" button — closes modal
- Escape key — closes modal
- Cross-modal navigation: "Manage" buttons close create modal, open target modal (350ms delay)

---

## 7. Environments Modal

### 7.1 List View
- "Environments" title + "New" button + "Close" button
- Per-environment row: name + "Built-in" badge (if applicable) + "View" (built-in) / "Edit" + "Delete" (custom)

### 7.2 Editor View (EnvironmentEditor)
- **Name** — text input (disabled in read-only/view mode)
- **Resource Limits** — CPU (number, step 0.5, "0 = unrestricted"), Memory (text, "e.g. 4g, 512m")
- **Docker** — "Enable Docker-in-Docker" checkbox with description
- **Credentials** — read-only display of credential file status per agent (configured/not set)
- **Network Access** — radio button group styled as cards:
  - Full (no restrictions)
  - Package managers (98 PM domains)
  - Custom (textarea for allowed domains + include PM domains checkbox)
  - Block (only agent API domains)
  - Block all (no outbound)
  - Agent API domains collapsible viewer (shown in restricted modes except block-all)
  - Package manager domains collapsible viewer with count
- **Expose APIs** — 3 checkboxes: Port Mappings, Domain Mappings, Usage Monitoring
- **Skills** — "Select All" toggle + per-skill checkbox with name and "Built-in" badge
- **AGENTS.md** — "Select All" toggle + per-entry checkbox with name and "Built-in" badge
- **Environment Variables** — system vars (read-only with lock icon) + custom textarea (KEY=VALUE format)
- **Setup Script** — textarea (4 rows, monospace)
- **Actions** — "Create"/"Update" + "Cancel"/"Close"

### 7.3 Validations
- Name cannot be empty
- Built-in environments: read-only (View mode, no edit/delete)

---

## 8. Skills Modal

### 8.1 List View
- "Skills" title + "New" button + "Close" button
- Per-skill row: name + "Built-in" badge + "View" (built-in) / "Edit" + "Delete" (custom)
- Empty state: "No skills yet. Create one to get started."

### 8.2 Editor View
- Name input (disabled in view mode)
- Content textarea (16 rows, monospace, YAML frontmatter + Markdown, disabled in view mode)
- "Create"/"Update" button (hidden in view mode) + "Cancel"/"Close"
- Save disabled if name or content empty

---

## 9. AGENTS.md Modal

### 9.1 List View
- "AGENTS.md" title + "New" button + "Close" button
- Same pattern as Skills: name + built-in badge + view/edit/delete buttons

### 9.2 Editor View
- Name input + content textarea (12 rows, Markdown)
- Same save/cancel pattern as Skills

---

## 10. Init Scripts Modal

### 10.1 List View
- "Init Scripts" title + "New" button + "Close" button
- Same pattern as Skills: name + built-in badge + view/edit/delete

### 10.2 Editor View
- Name input + content textarea (8 rows, Bash)
- New script pre-filled with `#!/bin/bash\n`
- Same save/cancel pattern

---

## 11. Settings Modal

### 11.1 Content
- "System Settings" title + "Expand all" / "Collapse all" buttons
- Description: "Read-only view of all system configuration"
- Loading state: "Loading settings..."
- Collapsible sections by category (8): Docker, Worker Defaults, Agent Authentication, Git Providers, Domain Mapping, Network, Init Scripts, App Types
- Per-item: label + env var key (monospace) + value display
  - Status type: colored badge (configured=success)
  - Boolean type: badge (enabled/disabled)
  - List type: wrapped tags
  - String/Number type: monospace text (or em-dash for null)

### 11.2 Interactions
- Section headers expand/collapse
- "Expand all" / "Collapse all" buttons
- "Close" button
- Settings refresh when modal opens

---

## 12. Port Mappings Panel

### 12.1 Empty State
- "No active mappings" message

### 12.2 Create Form (toggled by "+ Map" button)
- Type dropdown: "local" / "ext"
- Worker dropdown (only running containers, disabled placeholder "Worker")
- External port input (placeholder "Ext port")
- Arrow indicator (→)
- Internal port input (placeholder "Int port")
- "Add" button
- "Cancel" button (hides form)

### 12.3 Mapping List
- Per-mapping row: type badge (blue "local" / orange "ext") + external port (monospace) + arrow + worker name:internal port + remove (X) button
- Delete removes mapping immediately

---

## 13. Domain Mappings Panel

### 13.1 Conditional Visibility
- Only shown when domain mapper is enabled (BASE_DOMAINS env var configured)

### 13.2 Empty State
- "No active domain mappings" message

### 13.3 Create Form (toggled by "+ Map" button)
- Protocol toggle buttons: http, https, tcp (segmented group)
  - https/tcp disabled when no TLS configured on selected base domains
  - TCP exclusive (deselects http/https); http and https can combine
- Worker dropdown (only running containers)
- Subdomain text input (optional — empty maps bare domain)
- Base domain toggle (multi-select when multiple; toggles individual domains on/off)
- When multiple protocols and/or multiple base domains selected, creates cartesian product via batch API
- Internal port input
- Basic auth checkbox (hidden for TCP)
  - When enabled: username + password inputs
- "Cancel" and "Add" buttons

### 13.4 Mapping List
- Per-mapping row: protocol badge (blue=http, green=https, purple=tcp) + challenge type badge + full domain + lock icon (if basic auth) + arrow + worker name:port + remove button
- Challenge type badges: none (gray), http (emerald), dns (cyan), selfsigned/self (amber)

### 13.5 Protocol Interactions
- Switching to TCP hides Basic auth
- Switching back from TCP restores Basic auth
- Checking Basic auth reveals username/password fields

### 13.6 Self-Signed CA Certificate
- "CA cert" download button shown when any base domain uses `selfsigned` challenge type
- Downloads PEM file (`agentor-ca.crt`) via `GET /api/domain-mapper/ca-cert`
- User must trust this CA in their browser/OS to avoid TLS warnings
- Self-signed domains use wildcard certificates signed by this CA

---

## 14. Usage Panel

### 14.1 Content
- Loading state: "Loading..."
- Per-agent row: name (Claude, Codex, Gemini) + "Fetched Xm ago" timestamp + plan type badge + auth badge (OAuth=green, API key=blue, not configured=gray)
- Usage windows: progress bars per window
  - Label (Session, Weekly, Sonnet, etc.)
  - Color-coded: green (<50%), amber (50-79%), red (>=80%)
  - Percentage value (monospace)
  - Reset time (relative) with ISO tooltip
- Error display: red text
- Fallback: "No usage data for API key auth", "Not configured"

### 14.2 Interactions
- Refresh button (spinning icon while refreshing, disabled during refresh)
- Section collapse/expand
- Timestamps update every 30 seconds

---

## 15. Images / Update Notification Panel

### 15.1 Content
- Per-image row: image name (orchestrator, worker, mapper, traefik)
- Production mode indicators: digest values, update available (amber pulsing dot + old→new digest), error, current (green check), not found
- Per-image "Update" button (production mode, when update available)
- "Update All" button (production mode, when any updates available)
- "Re-check" / "Check for updates" button
- "Prune dangling images" button with result display

### 15.2 Restarting State
- Blue overlay with spinner + "Reconnecting..." + description when orchestrator restarts

---

## 16. Split Pane Layout

### 16.1 Pane Types
- Terminal (xterm.js)
- Desktop (noVNC iframe)
- Editor (code-server iframe)
- Apps (app instance management)
- Logs (centralized log viewer)

### 16.2 Tab Bar (PaneGroupTabBar)
- Per-tab: type icon + "[Container] - [Type]" label (truncated 140px) + close button (visible on hover, middle-click also closes)
- Active tab: highlighted background + accent bottom border
- Draggable tabs (HTML5 DnD)
- Drop insert indicator (vertical blue line)

### 16.3 Pane Splitting
- Drag tab to edge (left/right/top/bottom, 25% threshold) to split
- Drag tab to center to merge into existing group
- 5-zone drop overlay with visual indicators (blue highlight + directional icons)
- Minimum split size: 15%
- Same-direction splits insert as siblings (no unnecessary nesting)

### 16.4 Pane Separator Resize
- 4px separator between panes (12px hit area)
- Drag to resize adjacent panes
- Blue highlight on hover/drag
- Cursor: col-resize (horizontal) or row-resize (vertical)
- Pointer events disabled on iframes/xterm during drag

### 16.5 Focus
- Blue top border on focused pane group (when multiple panes exist)
- Mousedown on pane focuses it
- New tabs open in focused group

### 16.6 Persistence
- Entire pane layout (tree structure, tabs, focused node) persisted to localStorage
- Survives page reload
- Container removal clears associated tabs
- Node IDs rehydrated correctly after restore (no collisions)

---

## 17. Terminal Pane

### 17.1 Terminal
- xterm.js with WebSocket connection to Docker exec
- 10,000 line scrollback
- Alt+scroll for fast scrolling
- Font: Cascadia Code / Fira Code / JetBrains Mono / Menlo (14px)
- Auto-resize on container element resize (ResizeObserver)
- Theme-reactive (dark/light mode switching)
- Native text selection override (Mac: altKey, others: shiftKey)

### 17.2 Tmux Tab Bar (inner tab bar, 30px)
- Per-window tab: name (max 120px, truncated) + close button (hidden for main window)
- Active tab: highlighted with accent bottom border
- Click tab: switch window
- Click active non-default tab: inline rename mode
  - Enter: commit rename (sanitized: alphanumeric/underscore/hyphen only)
  - Escape: cancel
  - Blur: commit
- Close tab: click X or middle-click (with confirm dialog)
- Main ("shell") window: cannot be closed or renamed
- New tab creation: text input for name + "+" button
  - Empty input uses auto-generated placeholder (shell-xxxx)
  - Name collisions generate random name
- Polls for external changes every 3 seconds

---

## 18. Service Panes (Desktop & Editor)

### 18.1 Desktop (noVNC)
- Starting state: large icon + "Desktop is starting..." text
- Running state: green pulsing dot + "Desktop running" + "Open in tab" link + full iframe
- Service status polled every 5 seconds

### 18.2 Editor (code-server)
- Same pattern as Desktop
- "Editor is starting..." → "Editor running" + iframe
- "Open in tab" opens in new browser tab
- Clipboard permissions enabled on iframe

---

## 19. Apps Pane

### 19.1 Content
- "Apps" heading
- Empty state: "No app types available"
- Per app type: name, description, "+ New Instance" button
- Per instance: status dot (green/gray), instance ID (monospace), port label with tooltip, "Stop" button

### 19.2 App Types
- Chromium (CDP, ports 9222-9322, max 10)
- SOCKS5 proxy (ports 1080-1180, max 10)

---

## 20. Workspace Upload/Download

### 20.1 Upload Modal
- Opens from upload icon button on container card
- Title "Upload to Workspace" + target path description
- FileDropZone: drag files/folders, click to browse (folder mode), file list with remove/clear
- "Upload (N files)" button (disabled when empty, loading during upload)
- Auto-closes on success

### 20.2 Download
- Download button on container card triggers .tar.gz download of /workspace

---

## 21. Archived Workers

### 21.1 Section
- "Archived (N)" header, collapsed by default
- Collapsible with chevron toggle
- Only visible when archived workers exist
- Max height 192px, scrollable

### 21.2 Archived Worker Card
- Worker display name (truncated with tooltip)
- "Archived [date]" text
- "Unarchive" button (primary/blue)
- "Delete" button (error/red)

### 21.3 Interactions
- Unarchive: recreates container from stored metadata, preserves workspace
- Delete: permanently removes workspace + DinD volumes (with confirm dialog)

---

## 22. File Drop Zone

### 22.1 Drop Zone
- Dashed-border area with cloud-upload icon
- "Drop files or folders here" + "or click to browse folders"
- Blue highlight on dragover
- Recursive folder processing via FileSystemEntry API

### 22.2 File List
- Count + total size summary
- "Clear all" link
- Scrollable list (max 128px): filename + remove button (visible on hover)

---

## 23. Log Pane

### 23.1 Opening
- "Logs" button in System tab's Quick Links section opens the log pane
- Opens as a split pane tab (type "logs", singleton ID "__logs__")
- Tab shows "Logs" label with scroll-text icon

### 23.2 Filter Bar
- Source filter buttons: Orch, Worker, Mapper, Traefik (toggle each source on/off)
- Level filter buttons: DBG, INF, WRN, ERR (toggle each level on/off)
- When no filters active, all entries shown (buttons appear inactive)
- Active filter button shows accent border color
- Search input with 300ms debounce — filters entries by message substring

### 23.3 Log Entries
- Each entry shows: timestamp (HH:MM:SS.mmm) + level badge + source badge + source ID (for container logs) + message
- Level badges color-coded: debug (gray), info (blue), warn (amber), error (red)
- Source badges color-coded: orchestrator (purple), worker (green), mapper (cyan), traefik (orange)
- Source ID shows display name or container name (hidden for orchestrator entries)
- Error-level entries: red text
- Warn-level entries: amber text
- Hover highlights entry row
- Empty state: "No log entries" / "No log entries matching filters"

### 23.4 Auto-scroll
- Auto-scrolls to bottom when new entries arrive
- Manual scroll up disables auto-scroll
- Scrolling back to bottom re-enables auto-scroll
- Auto-scroll toggle button in filter bar

### 23.5 Actions
- Clear button: clears all log files (with confirmation dialog)
- Status bar: green/red connection dot + "Connected"/"Disconnected" text + entry count

### 23.6 Live Streaming
- WebSocket connection to `/ws/logs` for real-time log entries
- Auto-reconnect on disconnect (3s delay)
- History loaded from REST API on mount (500 most recent entries)
- Client-side buffer capped at 5000 entries

---

## 24. API Endpoints (Server-Side Features)

### 24.1 Health
- `GET /api/health` — returns `{ status: 'ok', containers: N }`

### 24.2 Containers
- `GET /api/containers` — list all workers
- `POST /api/containers` — create worker (name, displayName, environmentId, initScript, repos, mounts)
- `GET /api/containers/generate-name` — random name generation
- `POST /api/containers/:id/stop` — stop worker
- `POST /api/containers/:id/restart` — restart worker
- `DELETE /api/containers/:id` — remove worker (cleans up mappings, volumes, store)
- `POST /api/containers/:id/rebuild` — rebuild worker (destroys and recreates with latest image, preserves workspace and metadata)
- `POST /api/containers/:id/archive` — archive (cleans up mappings)
- `GET /api/containers/:id/logs` — logs with optional ?tail=N (default 200, max 10000)
- `GET /api/containers/:id/workspace` — download workspace .tar.gz
- `POST /api/containers/:id/workspace` — upload files (multipart, path traversal protection)
- `GET /api/containers/:id/desktop/status` — desktop service status
- `GET /api/containers/:id/editor/status` — editor service status

### 24.3 Tmux Panes
- `GET /api/containers/:id/panes` — list tmux windows
- `POST /api/containers/:id/panes` — create window (optional name, auto-generated "shell-xxxx")
- `PUT /api/containers/:id/panes/:windowIndex` — rename window (name validation: alphanumeric/underscore/hyphen)
- `DELETE /api/containers/:id/panes/:windowIndex` — kill window (window 0 protected: 403)

### 24.4 Apps
- `GET /api/containers/:id/apps` — list all app instances
- `GET /api/containers/:id/apps/:appType` — list by type
- `POST /api/containers/:id/apps/:appType` — start instance
- `DELETE /api/containers/:id/apps/:appType/:instanceId` — stop instance
- `GET /api/app-types` — list app type definitions

### 24.5 Port Mappings
- `GET /api/port-mappings` — list all
- `POST /api/port-mappings` — create (externalPort, internalPort, type, workerId/workerName)
- `DELETE /api/port-mappings/:port` — remove
- `GET /api/port-mapper/status` — counts by type
- Validations: port range 1-65535, type localhost/external, worker must exist and be running, duplicate port 409

### 24.6 Domain Mappings
- `GET /api/domain-mappings` — list all
- `POST /api/domain-mappings` — create (subdomain, baseDomain, protocol, workerId/workerName, internalPort, basicAuth)
- `POST /api/domain-mappings/batch` — batch create (single Traefik reconcile)
- `DELETE /api/domain-mappings/:id` — remove (idempotent)
- `GET /api/domain-mapper/status` — enabled flag, baseDomains list, hasSelfSignedCa flag, dashboard URL
- `GET /api/domain-mapper/ca-cert` — download self-signed CA certificate PEM (404 when no selfsigned domains)
- Validations: protocol http/https/tcp, HTTPS/TCP require TLS, subdomain format, port range, duplicate 409, protocol conflict 409

### 24.7 Environments
- `GET /api/environments` — list all
- `POST /api/environments` — create
- `GET /api/environments/:id` — get single
- `PUT /api/environments/:id` — update
- `DELETE /api/environments/:id` — delete
- Built-in "default" environment: cannot edit/delete

### 24.8 Skills
- `GET /api/skills` — list all
- `POST /api/skills` — create custom
- `GET /api/skills/:id` — get single
- `PUT /api/skills/:id` — update custom
- `DELETE /api/skills/:id` — delete custom
- Built-in skills: port-mapping, domain-mapping, usage, tmux

### 24.9 AGENTS.md
- `GET /api/agents-md` — list all
- `POST /api/agents-md` — create custom
- `GET /api/agents-md/:id` — get single
- `PUT /api/agents-md/:id` — update custom
- `DELETE /api/agents-md/:id` — delete custom
- Built-in entry: platform-guide

### 24.10 Init Scripts
- `GET /api/init-scripts` — list all
- `POST /api/init-scripts` — create custom
- `GET /api/init-scripts/:id` — get single
- `PUT /api/init-scripts/:id` — update custom
- `DELETE /api/init-scripts/:id` — delete custom
- Built-in scripts: claude, codex, gemini

### 24.11 Archived Workers
- `GET /api/archived` — list
- `POST /api/archived/:name/unarchive` — restore
- `DELETE /api/archived/:name` — permanently delete

### 24.12 Updates
- `GET /api/updates` — status for 4 images
- `POST /api/updates/check` — trigger manual check
- `POST /api/updates/apply` — pull + recreate (optional { images } body for per-image)
- `POST /api/updates/prune` — prune dangling images

### 24.13 Usage
- `GET /api/usage` — agent usage status (per-agent auth type, windows, timestamps)
- `POST /api/usage/refresh` — trigger immediate refresh

### 24.14 GitHub
- `GET /api/github/repos` — list repos + orgs
- `POST /api/github/repos` — create repo (name, owner, private)
- `GET /api/github/repos/:owner/:repo/branches` — list branches + default

### 24.15 Configuration
- `GET /api/settings` — all settings (categorized, read-only)
- `GET /api/orchestrator-env-vars` — env vars with configured status
- `GET /api/git-providers` — provider list with token status
- `GET /api/agent-api-domains` — firewall allowlist
- `GET /api/package-manager-domains` — PM domain list
- `GET /api/credentials` — credential file status per agent

### 24.16 Logs
- `GET /api/logs` — query log entries with filters (sources, sourceIds, levels, since, until, limit, search)
- `DELETE /api/logs` — clear all log files
- `GET /api/log-sources` — list known container log sources
- `WS /ws/logs` — live log stream (JSON-encoded LogEntry per message, read-only)

### 24.17 WebSocket/Proxy
- `WS /ws/terminal/:containerId` — terminal (default window)
- `WS /ws/terminal/:containerId/:windowIndex` — terminal (specific window)
- `WS /ws/desktop/:containerId` — VNC relay
- HTTP+WS `/editor/:containerId/**` — code-server proxy
- HTTP `/desktop/:containerId/**` — noVNC proxy

---

## 25. UI State Persistence

### 25.1 localStorage Key
- Single key: `agentor-ui-state`
- 500ms debounced writes + `beforeunload` flush

### 25.2 Persisted State
- Sidebar width (clamped 200-700)
- Sidebar collapsed state
- Panel collapse states (archived, portMappings, domainMappings, usage, images, settings)
- Split pane tree (rootNode + focusedNodeId)
- Tmux active windows per container

### 25.3 Graceful Degradation
- Corrupt localStorage: falls back to defaults
- Partial state: fills missing fields with defaults
- Width clamping: below 200 → 200, above 700 → 700

---

## 26. Agent Setup Defaults

### 26.1 Default MCP Servers
- All agents get two MCP servers pre-configured on first startup
- **Playwright MCP** (`@playwright/mcp@latest`): browser automation via Playwright
- **Chrome DevTools MCP** (`chrome-devtools-mcp@latest`): Chrome DevTools Protocol access
- Claude: configured in `~/.claude.json` under `mcpServers` (user scope)
- Codex: configured in `~/.codex/config.toml` under `[mcp_servers.*]` sections
- Gemini: configured in `~/.gemini/settings.json` under `mcpServers`
- Write-once: user modifications to config files are preserved on restart/rebuild
- MCP packages are downloaded via `npx -y` on first agent use
