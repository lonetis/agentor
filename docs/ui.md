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

## VS Code Tunnel Pane

Custom pane (not iframe-based) for managing VS Code tunnel connections to workers. Opens via the "VS Code Tunnel" button on container cards (tab type `vscode`).

**Architecture** (`VsCodeTunnelPane.vue` + `useVsCodeTunnel` composable):
- `useVsCodeTunnel(containerId)` polls `GET /api/containers/:id/vscode-tunnel/status` every 3s
- Status, start, and stop endpoints exec `/home/agent/apps/vscode-tunnel/manage.sh` in the worker container
- Three states: stopped (start button), auth_required (GitHub device code URL + code), running (connection instructions)
- Auth persists per worker in the agent-data volume (`~/.vscode` symlinked to `.agent-data/.vscode`) — survives restarts, rebuilds, and archive/unarchive

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
