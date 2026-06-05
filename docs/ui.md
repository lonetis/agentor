# UI System

## Split Pane Layout

VS Code-style editor groups with recursive splits. Tabs can be dragged to any edge (left/right/top/bottom) to create horizontal or vertical splits, or to the center to merge into an existing group.

**Data model** (`useSplitPanes` composable, singleton module state):
- `rootNode: PaneNode | null` — recursive tree where each node is either a **leaf** (has `tabs[]`, `activeTabId`, `sizeFraction`) or a **container** (has `direction: 'horizontal'|'vertical'`, `children: PaneNode[]`, `sizeFraction`)
- `focusedNodeId` — which leaf receives new tabs from sidebar actions
- Type guards: `isLeaf(node)` / `isContainer(node)` — exported from composable
- Tree operations: splitting a leaf wraps it in a container; closing all tabs in a leaf collapses single-child containers recursively; same-direction splits insert as siblings (avoids unnecessary nesting)
- Public API: `rootNode`, `focusedNodeId`, `tabs`, `activeTabId`, `openTab`, `closeTab`, `closeTabsForContainer`, `focusGroup`, `moveTab`, `splitWithTab`, `resizeNodes`, `activateTab`

**Layout** (`SplitPaneLayout.vue` + `PaneSplitNode.vue`):
- `SplitPaneLayout` is a thin wrapper that renders a single `PaneSplitNode` rooted at `rootNode`
- `PaneSplitNode` is a recursive component: leaf nodes render `PaneGroupTabBar` + `PaneContent` + `PaneDropOverlay`; container nodes render `flex-row` (horizontal) or `flex-col` (vertical) with recursive children + `PaneSeparator` between them
- `PaneSeparator` accepts a `direction` prop — horizontal mode uses `cursor: col-resize`, vertical mode uses `cursor: row-resize`
- `PaneDropOverlay` uses 5-zone nearest-edge detection (left/right/top/bottom at 25% threshold, center otherwise)

**Drag-and-drop** (`useDragTab` composable):
- HTML5 DnD API (`draggable`, `dragstart`, `dragover`, `drop`, `dragend`)
- `body.tab-dragging` class disables pointer events on iframes/xterm during drag
- `body.split-dragging` (horizontal) and `body.split-dragging-v` (vertical) during separator resize
- Drop zones: edge 25% → split in that direction, center → merge into leaf

**Terminal resize**: `ResizeObserver` on the terminal container element handles all resize scenarios (window resize, sidebar drag, pane separator drag) — no manual callback propagation needed.

## Tmux Tab Integration

Web-native tab bar inside the terminal pane — each tab represents a tmux window in the container's tmux session. Replaces manual tmux keyboard shortcuts with clickable tabs.

**Architecture** (`TerminalPane.vue` + `useTmuxTabs` + `TmuxTabBar`):
- `useTmuxTabs(containerId)` manages the tmux window list: fetches via API, polls every 3s for external changes (e.g. agent creating windows), provides create/close/activate/rename
- `TerminalPane` maintains a `Map<windowIndex, useTerminal()>` — one terminal per tmux window, all with live WebSocket connections
- `v-show` toggles visibility (not `v-if`) so hidden terminals keep their DOM, scrollback buffer, and WebSocket stream
- `TmuxTabBar` renders the inner tab bar (30px, dark theme, visually subordinate to the outer pane tab bar)
- Active window persisted per container in a module-level `Map` — survives outer tab close/reopen
- The main "shell" window cannot be closed or renamed — close button hidden, rename disabled
- New tab name input next to "+" button — type a name before creating, or leave empty for auto-generated `shell-{4char}`
- Click an already-active tab to inline-rename it (input replaces label, Enter to confirm, Escape to cancel)
- 10k scrollback per terminal, Alt+scroll for fast scrolling

## Worker Settings Modal

A worker's editable configuration lives in a single **Worker Settings modal** (`ContainerDetailModal.vue`) — there is no read-only detail view. Worker-related settings are split into two tiers; environment-specific settings (CPU/memory, network, Docker, capabilities, instructions, setup script, env vars, exposed APIs) are **not** shown here — they belong to the Environments modal.

- **Applies immediately (no rebuild)** — `displayName`. Saving applies it to the running worker immediately (the `PATCH` updates the stored label + in-memory state; no recreation). Tagged with a green `no rebuild needed` badge.
- **Rebuild-requiring edits** — `environmentId`, `repos`, `mounts`, `initScript`. Baked into the container at create time (the `WORKER`/`ENVIRONMENT` env JSON and Docker `Binds`), so saving only updates the stored desired config and flags the worker `pendingRebuild: true`. Each is tagged with an amber `requires rebuild` badge. A rebuild re-resolves from the stored config and clears the flag.

The modal computes which fields changed: a pure display-name change shows just **Save**; any rebuild-requiring change additionally shows **Save & Rebuild** (persist + rebuild now) plus a "Changes require a rebuild" hint. While `pendingRebuild` is set, the header shows a `Rebuild pending` badge and a banner with a **Rebuild now** button.

The flow front-to-back:

- **Create Worker modal**: the first field is labeled "Display name" (free-form, no keystroke sanitization). Its placeholder is a friendly suggestion fetched from `GET /api/containers/generate-name` (`{ displayName }`). On submit the client sends only `{ displayName }` (the typed value, or the suggestion when left blank) — never an `id`; the orchestrator mints the worker UUID.
- **ContainerCard**: shows `displayName || shortName(id)`. A "Settings" pencil button (`i-lucide-pencil`, in a `<UTooltip text="Settings">`) in the action row — and a click on the card title — opens the settings modal. When the worker has unapplied rebuild edits the card shows an amber `rebuild pending` badge next to its status. The card forwards an `update(id, patch, rebuild)` event (PATCH + optional rebuild) and a `rebuild(id)` event to `index.vue`'s `handleUpdate`, which relabels open tmux tabs when the display name changed and runs a rebuild when requested. The card also emits `export(id)` (→ `index.vue` `handleExportWorker` anchor download) and shows a per-worker live-metrics row (see **Resource Metrics & Worker Export/Import UI** below).
  - **Action row layout**: all buttons are left-aligned in logical groups separated by `w-px` vertical dividers — views (terminal/editor/desktop/apps) | workspace (upload/download/**export**) | lifecycle (settings/restart-or-stop/rebuild) | destructive (archive/remove). Views + workspace show only when running; lifecycle + destructive always. The row (`.card-actions`) is a single no-wrap flex strip with `overflow-x: auto` + hidden scrollbar; a vertical wheel over it scrolls horizontally (`onActionsWheel`), so it stays usable when the sidebar is narrow. The Rebuild button is neutral (not colored).
- **ContainerDetailModal**: read-only **Worker** identity section (Worker ID = the worker UUID `container.id` in monospace, Container ID = the Docker `container.containerId` first 12 chars, Image = `container.imageName`, Image ID, Created) + an editable **Settings** section (Display name `UInput`, Environment `USelect`, Repositories via `RepoInput`, Volume Mounts via `MountInput`, Init Script via `useInitScriptSync` preset + textarea) + read-only **Info** sections (Port Mappings, Domain Mappings, App Instances) shown only when present. The form re-initialises from the worker each time the modal opens. `useContainers().updateContainerSettings(id, patch)` issues the `PATCH`.
- **Port/Domain mapping panels**: each row resolves the worker's `displayName` from the live container list by `containerName` (fallback `shortName(m.workerId)`), so rows show the friendly label rather than the raw UUID.

## Resource Metrics & Worker Export/Import UI

**Per-worker metrics** (`useWorkerMetrics`): the only resource metrics — there is no host/system card (host metrics are OS-dependent; everything here goes through the Docker API). Polled **once** in `AppSidebar` (one 10s `GET /api/worker-metrics`) and passed to each `ContainerCard` as a `metric` prop via `metricFor(id)` — so adding cards does not multiply pollers. The card renders a compact `data-testid="worker-metrics"` row (CPU% of host, RAM **used bytes**, Disk **used bytes**, ↓down/↑up) only while running. cpu/mem/net come from `container.stats` (3s server cadence). Disk is sampled server-side on a slower 60s cadence — the container's writable-layer size (`SizeRw`, excludes the base image) plus a `du` of its `/workspace` + agent-data volumes (storage-mode-agnostic; DinD excluded). `formatBytes`/`formatRate` (`app/utils/format.ts`) format the values.

**Worker export**: the card's Export button (`i-lucide-package`, tooltip "Export worker"/"Preparing export…") lives in the workspace group next to Download Workspace. It `fetch`es `GET /api/containers/:id/export` (default-on `docker export` rootfs) with a local `exporting` ref driving a spinner + disabled state — because the server materialises the whole bundle before the response starts, a bare anchor would look like nothing is happening. On completion it saves the response via a blob URL (filename from `Content-Disposition`).

**Worker import** (`ImportWorkerModal.vue`): opened from the sidebar "Import worker" button (`aria-label="Import worker"`). A native file picker + optional display-name input; the Import button is disabled until a bundle is chosen. On submit, `useContainers().importContainer(file, displayName)` POSTs the file as the raw `application/x-tar` body to `/api/containers/import`; on success `index.vue`'s `onWorkerImported` refreshes the list and opens a terminal tab for the restored worker.

## Theme System

Three-way color mode toggle (Default/White/Dark) in the sidebar header, powered by `@nuxtjs/color-mode` (bundled with Nuxt UI v3). Default preference is `dark` (preserves the original dark-only UI). Persisted to `localStorage` automatically.

| Mode | Behavior |
|------|----------|
| **Default** | Follows OS preference (`prefers-color-scheme`) |
| **White** | Forces light mode |
| **Dark** | Forces dark mode |

**Architecture:**
- `ThemeToggle.vue` — segmented icon button group (monitor/sun/moon) that sets `useColorMode().preference`
- Tailwind `dark:` variants on all custom classes (e.g., `bg-gray-50 dark:bg-gray-900`)
- CSS custom properties in `main.css` for hex-color scoped styles: pane tab bar (`--pane-tab-*`), terminal area (`--terminal-*`), scrollbar (`--scrollbar-*`)
- Nuxt UI components (UButton, UModal, UInput, etc.) handle dark mode natively
- xterm.js theme defined as `DARK_THEME` / `LIGHT_THEME` constants in `useTerminal.ts`, reactively switched via `watch(colorMode.value)`
- TmuxTabBar scoped CSS uses `--terminal-*` CSS variables for seamless theme transitions

## VS Code Editor (code-server)

Browser-based VS Code editor integrated into each worker container via [code-server](https://github.com/coder/code-server). Runs on port 8443 with no authentication (`--auth none`), accessible through the orchestrator's HTTP/WebSocket proxy.

**Architecture:**
- `ServicePane.vue`: unified iframe-based pane for both desktop (noVNC) and editor (code-server), parameterized by endpoint, label, icon, and URL
- `useContainerServiceStatus.ts`: polls service status endpoint for a container
- `editor/[containerId]/index.ts`: Combined HTTP+WS handler for bare editor path (h3 `defineEventHandler({ handler, websocket })`)
- `editor/[containerId]/[...path].ts`: Combined HTTP+WS handler for sub-paths (same pattern, strips `/editor/{id}` prefix for WS relay)
- Worker entrypoint starts code-server in Phase 3b (after display stack, before git auth)
- Default workspace folder: `/workspace`

## UI State Persistence

All client-side UI state is consolidated into a single localStorage key (`agentor-ui-state`) managed by the `useUiState` composable (`orchestrator/app/composables/useUiState.ts`). Color mode is the only exception — it stays with `@nuxtjs/color-mode`.

**State shape** (`UiState`, version 1):
- `sidebar.width` — sidebar pixel width (200-700, default 320)
- `sidebar.collapsed` — sidebar collapsed toggle (default false)
- `sidebar.panels` — per-section collapse states: `archived` (default true), `portMappings`, `domainMappings`, `usage`, `images` (default false)
- `panes.rootNode` — serialized `PaneNode` tree (split pane layout + open tabs)
- `panes.focusedNodeId` — which leaf pane group is focused
- `tmux.activeWindows` — `Record<containerId, windowIndex>` for restoring active tmux tab per terminal

**Architecture:**
- Module-level singleton ref, loaded from localStorage on first access
- 500ms debounced writes via `scheduleWrite()`, plus `beforeunload` flush
- Defensively merges stored JSON into defaults (handles partial/corrupt data)
- `useSidebarResize` reads initial width/collapsed from `useUiState().state` and writes back via `setSidebarWidth()`/`setSidebarCollapsed()`
- `AppSidebar.vue` panel collapse refs are computed get/set backed by `useUiState().state.sidebar.panels`
- `useSplitPanes` initializes `rootNode`/`focusedNodeId` from stored state, rehydrates `_nextNodeId` from the restored tree, and deep-watches for changes
- `useTmuxTabs` uses `getTmuxActiveWindow()`/`setTmuxActiveWindow()` instead of a module-level Map
- `_resetUiState()` export for testing (clears singleton + timers)

## Apps pane row dispatch

`AppsPane.vue` iterates the app-type list and renders a row component per `appType`:
- `chromium` / `socks5` → `AppInstanceRow.vue` (status dot, port label, Stop button)
- `vscode` → `VsCodeAppRow.vue` (stopped / auth_required / running states; shows the GitHub device-code URL + code during auth, and the machine name once the tunnel connects; prompts the user to open **Remote - Tunnels** in their local VS Code)
- `ssh` → `SshAppRow.vue` (stopped / running states; shows the `ssh agent@<host> -p <externalPort>` connect string with a copy-to-clipboard button; warns when the user has not saved an SSH public key in **Account → SSH Access**)

For singleton apps (`appType.singleton`) the header row shows a **Start** button when no instance is running, and hides it once one exists (Stop lives on the row itself). Multi-instance apps show **+ New Instance** as before.

VS Code tunnel auth persists per worker in the agent-data volume (`~/.vscode` symlinked to `.agent-data/.vscode`) — survives restarts, rebuilds, and archive/unarchive. Stopping and re-starting the app from the UI does not re-require auth.

## Log Pane

Centralized log viewer opened via the "Logs" button in the System tab's Quick Links. Each click opens a new independent Logs tab (type `logs`) — multiple log panes can coexist and be arranged side-by-side. All instances share the same underlying module-level log state (one WebSocket, one in-memory entry buffer), so the panes stay in lock-step but each has its own viewport, scroll position, and tab identity.

**Architecture** (`LogPane.vue` + `useLogs` composable):
- `useLogs()` manages module-level singleton state: log entries array, filter state, WebSocket connection, lazy-load state (`loadingMore`, `loadingInitial`, `hasMoreOlder`, `liveTick`). Multiple `LogPane.vue` instances subscribe to this shared state.
- WebSocket connects to `/ws/logs` for live streaming, auto-reconnects after 3s on disconnect
- On first mount, fetches 500 most recent entries via `GET /api/logs`, then switches to WebSocket for live updates
- **Lazy load**: scrolling within ~80px of the top calls `loadMore()`, which fetches the next older page via `GET /api/logs?until=<oldest>&limit=500` and prepends the result. Scroll position is anchored to the same content via a `scrollHeight` delta so the user does not jump. A spinner ("Loading older entries…") shows during fetch; a "Beginning of logs" marker shows once no more pages are available.
- **Auto-scroll**: a `liveTick` ref bumped only when the WebSocket pushes a new entry triggers scroll-to-bottom (so pagination prepends never trigger an unwanted jump). On first paint, the pane snaps to the bottom once entries arrive.
- **Soft cap (50,000 entries)** with conditional eviction: only culls from the front when the user is at the bottom (`autoScroll === true`), so scrolled-back history is never yanked out from under the user. Evicted entries are still on disk and can be re-fetched via scroll-up.
- Filters propagate to both the server (paginated fetches use them) and the client (live entries are gated client-side). Changing a filter refetches the most recent page from scratch via an internal `filterEpoch` that invalidates any in-flight `loadMore`.
- Filter bar: source toggles (orchestrator, worker, traefik), level toggles (debug, info, warn, error), text search (300ms debounce)
- Color-coded badges: level (debug=gray, info=blue, warn=amber, error=red), source (orchestrator=purple, worker=green, traefik=orange)
- Uses terminal CSS variables (`--terminal-*`) for seamless theme integration
