# Agentor — Comprehensive Feature List

Every user-facing feature of the Agentor web dashboard, organized by category. This document drives the Playwright test suite — every item below must have test coverage.

---

## 0. Authentication & Authorization

### 0.1 First-run Setup
- `/api/setup/status` is public and returns `{ needsSetup: boolean }`
- When no users exist, navigating to any dashboard URL redirects to `/setup`
- Setup page asks for name, email, password, confirm password
- Password must be at least 8 characters; passwords must match
- `/api/setup/create-admin` creates the first user with role = `admin`, auto-signs them in, and redirects to `/`
- Once any user exists, `/api/setup/create-admin` returns 409
- Setup page redirects to `/login` when setup is already complete

### 0.2 Login
- Navigating to any protected URL while unauthenticated redirects to `/login`
- Login page renders email + password fields and a Sign in button
- `/login` is public (bypasses the auth middleware)
- Incorrect credentials show an error message, no redirect
- Correct credentials redirect to `/` (dashboard) via full page reload
- Authenticated users navigating to `/login` are redirected to `/`

### 0.3 Sign Out
- Sign out button appears in the sidebar Account card (System tab)
- Clicking it calls `POST /api/auth/sign-out` and redirects to `/login`
- Sessions are invalidated server-side; subsequent `get-session` returns no user

### 0.4 Roles
- Two roles: `admin` and `user`
- Admin role sees every user's resources; user role sees only their own + built-in/global resources
- `/api/auth/admin/*` endpoints (create, list, setRole, remove, ban/unban) are restricted to admins

### 0.5 Resource Ownership
- Workers, port mappings, domain mappings, environments, capabilities, instructions, init scripts all carry a `userId`
- Built-in capabilities/instructions/init-scripts/environments have `userId: null` and are visible to all users
- Regular users cannot see or modify another user's resources (403 on mutations, filtered out of list responses)
- Admins can see and modify everything
- Port/domain mappings inherit the `userId` of the target worker

### 0.6 Admin-only Endpoints
- `GET /api/settings` — 403 for non-admin
- `GET /api/logs`, `DELETE /api/logs`, `WS /ws/logs` — admin-only
- `POST /api/updates/apply`, `/check`, `/prune` — admin-only

### 0.7 System Tab (Admin Only)
- The sidebar System tab (Images card, Logs button, System Settings button, Users button, API Docs link) is only shown to admin users — every action inside it hits an admin-only endpoint. Regular users do not see the System tab at all.

### 0.8 Users Modal (Admin Only)
- "Users" button appears in the sidebar System tab Quick Links for admins only
- Modal lists all users with role badge and current-user indicator
- Create user form (name, email, password, role)
- Change role action (promote to admin / demote to user)
- Delete user action (with confirmation)

### 0.9 Account Card
- Sidebar footer (pinned to bottom, always visible across tabs) shows the current user's avatar, name, email, admin badge, and a Sign out icon button
- Clicking the user info (avatar/name/email area) opens the Account modal

### 0.9b Account Modal (self-service)
- Accessible from the sidebar footer by clicking the user info area
- **Profile section**: edit name and email, Save button. Email changes apply immediately (no verification email sent — Agentor does not send email).
- **Change password section**: current password + new password (min 8 chars) + confirm new password. Server rejects the wrong current password.
- **API keys & tokens section**: per-user inputs for `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`. All fields are masked password inputs with a show/hide eye toggle. Values are injected into every worker the user creates.
- **Custom environment variables section**: list of `{key, value}` rows with Add/Remove. Keys validated to `[A-Z_][A-Z0-9_]*`; reserved names (`ENVIRONMENT`, `WORKER`, `ORCHESTRATOR_URL`, etc.) are rejected with an inline error. Saved together with the API keys via a single "Save env vars" button (`PUT /api/account/env-vars`).
- **Agent OAuth credentials section**: per-agent (claude/codex/gemini) status indicator (`Logged in` green / `Not logged in` gray) plus a per-agent **Reset** button (two-step confirm) that overwrites the OAuth file with `{}` so the next CLI login writes fresh tokens. Login itself happens by running the agent CLI inside one of the user's workers — credentials live at `<DATA_DIR>/users/<userId>/credentials/` and are bind-mounted into all of the user's workers.
- Success and error messages displayed per section
- Backed by `/api/auth/update-user`, `/api/auth/change-email`, `/api/auth/change-password` (built-in better-auth) and Agentor's per-user `/api/account/env-vars` and `/api/account/agent-credentials` endpoints

### 0.9c Admin Password Reset
- In the Users modal each row has a "Reset password" button that prompts for a new password and calls `/api/auth/admin/set-user-password`
- No current password required — only admins can invoke this endpoint

### 0.10 WebSocket Authentication
- All `/ws/terminal/:id[/:windowIndex]` connections require a valid session cookie and container ownership
- `/ws/desktop/:id`, editor proxy, and log stream WebSocket endpoints reject unauthenticated peers

### 0.11 Layered Auth
- Traefik dashboard basic auth (`DASHBOARD_AUTH_USER`/`PASSWORD`) still works as an additional layer in front of the orchestrator; user auth is independent

### 0.12 Passkey (WebAuthn) Authentication
- **Conditional enablement**: Passkeys are only available when the dashboard is served over Traefik with both `DASHBOARD_SUBDOMAIN` and `DASHBOARD_BASE_DOMAIN` set. When disabled, the passkey plugin is not registered at all and every passkey UI element is hidden via the `passkeysEnabled` flag on `GET /api/setup/status`. WebAuthn config (when enabled): `rpID = <subdomain>.<base>` (override with `BETTER_AUTH_RP_ID`), `origin = https://<subdomain>.<base>`, `rpName = 'Agentor'`. Users must access the dashboard via the Traefik URL for passkey flows to work.
- **Setup page** has a Password / Passkey toggle (only shown when passkeys are enabled). The Passkey path creates the initial admin via `POST /api/setup/create-admin-passkey-token` and `client.passkey.addPasskey({ context: token })` — no password required.
- **Login page** shows a "Sign in with passkey" button under the password form (only when passkeys are enabled). Conditional UI auto-fill is enabled but disabled when `navigator.webdriver` is set (avoids races in automation).
- **Account modal — Passkeys section**: lists registered passkeys (name, "Added <date>", Remove button), Add passkey form (with optional name), two-step confirmation for removal.
- **Account modal — Password section**: heading switches between "Change password" and "Set a password" depending on whether the user has one. "Remove password" button (two-step confirm) shown only when the user also has a passkey. "Set password" path uses `POST /api/account/set-password` and does not require a current password.
- **Credential balance invariant**: a user must always have at least one credential. Server enforces:
  - `POST /api/account/remove-password` returns 409 when no passkey is registered.
  - `server/middleware/passkey-guard.ts` intercepts `POST /api/auth/passkey/delete-passkey` and returns 409 when deleting the last passkey would leave the user with no credentials.
- **Custom endpoints**:
  - `GET /api/account/credentials` returns `{ hasPassword, passkeyCount }` for the current user.
  - `POST /api/account/set-password` sets a new password without requiring the current one (used by passwordless users).
  - `POST /api/account/remove-password` removes the password credential.
  - `POST /api/setup/create-admin-passkey-token` issues a one-shot 5-minute token for first-run passkey-only admin creation.
- **Better-auth passkey endpoints** (mounted under `/api/auth/passkey/*` when enabled): `generate-register-options`, `verify-registration`, `list-user-passkeys`, `delete-passkey`, `update-passkey`, plus `/api/auth/sign-in/passkey`.

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
- "Capabilities" button opens capabilities modal
- "Instructions" button opens instructions modal
- "Init Scripts" button opens init scripts modal
- The Capabilities / Instructions / Init Scripts trio sits on one row while the sidebar is wide; once the sidebar is narrower than ~280px the row stacks the three buttons vertically so their labels never get truncated

### 1.4 Sidebar Sections (all collapsible with chevron toggle)
- **Workers** — list of active container cards
- **Archived** — collapsed by default, only shown when archived workers exist, shows count
- **Port Mappings** — always visible
- **Domain Mappings** — only visible when domain mapper is enabled (BASE_DOMAINS configured)
- **Usage** — always visible, has refresh button
- **Images** — always visible
- **Settings** — always visible, contains "Logs" button, "System Settings" button, and "API Docs" link

### 1.5 Sidebar Tab Bar Overflow
- All tab buttons (Workers / Archived / Ports / Domains / Usage / System) are rendered in a horizontally scrollable row
- The scrollbar itself is hidden for a clean look; scrolling still works via mouse wheel (vertical wheel is converted to horizontal scroll), trackpad, and keyboard
- When one or more tabs have less than 20% of their width visible inside the scroll viewport, a "More" chevron button pins to the right edge with a gradient fade and opens a dropdown listing those (mostly) hidden tabs
- A tab with at least 20% of its width visible stays out of the dropdown — this gives a small hysteresis zone so tabs don't pop in and out while scrolling past them
- Scrolling the tab bar updates the dropdown live — tabs that become visible drop out, tabs that scroll off join
- Once the sidebar is wide enough that every tab is fully visible (or at least 20% visible after scrolling), the "More" button disappears entirely

---

## 2. Sidebar Resize & Collapse

### 2.1 Resize
- Drag handle at right edge of sidebar
- Width range: 200px minimum to 90% of the current viewport width maximum
- Dragging below the 120px collapse threshold snaps the sidebar closed on release (VS Code-style) while preserving the last valid width for re-expand
- Width persisted to localStorage (persistence clamp 200–3000; runtime re-clamped to 90% of viewport on window resize)
- No width transition while actively dragging — the sidebar tracks the cursor instantly

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
- VS Code Tunnel button (tooltip "VS Code Tunnel") — opens VS Code tunnel pane
- Apps button (tooltip "Apps") — opens apps pane
- Upload button (tooltip) — opens upload modal
- Download button (tooltip) — downloads workspace as .tar.gz

### 4.3 Action Buttons
- "Stop" — visible when running, stops the container
- "Restart" — visible when stopped, restarts the container
- "Rebuild" — always visible, destroys and recreates container with latest image (confirm dialog, preserves workspace, agents, and DinD volumes + port/domain mappings — equivalent to archive + unarchive)
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
- **Capabilities** — "Select All" toggle + per-capability checkbox with name and "Built-in" badge
- **Instructions** — "Select All" toggle + per-entry checkbox with name and "Built-in" badge
- **Environment Variables** — system vars (read-only with lock icon) + custom textarea (KEY=VALUE format)
- **Setup Script** — textarea (4 rows, monospace)
- **Actions** — "Create"/"Update" + "Cancel"/"Close"

### 7.3 Validations
- Name cannot be empty
- Built-in environments: read-only (View mode, no edit/delete)

---

## 8. Capabilities Modal

### 8.1 List View
- "Capabilities" title + "New" button + "Close" button
- Per-capability row: name + "Built-in" badge + "View" (built-in) / "Edit" + "Delete" (custom)
- Empty state: "No capabilities yet. Create one to get started."

### 8.2 Editor View
- Name input (disabled in view mode)
- Content textarea (16 rows, monospace, YAML frontmatter + Markdown, disabled in view mode)
- "Create"/"Update" button (hidden in view mode) + "Cancel"/"Close"
- Save disabled if name or content empty

---

## 9. Instructions Modal

### 9.1 List View
- "Instructions" title + "New" button + "Close" button
- Same pattern as Capabilities: name + built-in badge + view/edit/delete buttons

### 9.2 Editor View
- Name input + content textarea (12 rows, Markdown)
- Same save/cancel pattern as Capabilities

---

## 10. Init Scripts Modal

### 10.1 List View
- "Init Scripts" title + "New" button + "Close" button
- Same pattern as Capabilities: name + built-in badge + view/edit/delete

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
- Collapsible sections by category: Docker, Worker Defaults, Git Providers (clone domains only; tokens are per-user), Domain Mapping, Network, Init Scripts, App Types. (The legacy Agent Authentication section is removed — agent API keys and OAuth tokens are per-user and managed from the Account modal.)
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

> Port mappings and domain mappings both run on the same **Traefik** container (`agentor-traefik`). There is no separate `agentor-mapper` container. Each port mapping becomes a dedicated TCP entrypoint on Traefik (`pm-<port>`) with a `HostSNI(*)` catch-all router that forwards to `workerName:internalPort`. Adding or removing a port mapping triggers a Traefik container recreate because entrypoints are part of Traefik's static config.

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
- Path input (optional, hidden for TCP — e.g. /api; prefix stripped before forwarding)
- Internal port input
- Basic auth checkbox (hidden for TCP)
  - When enabled: username + password inputs
- Wildcard subdomain checkbox
  - Enabled only when all selected base domains have challenge type `none`, `dns`, or `selfsigned` (disabled with tooltip for `http` HTTP-01 ACME)
  - When checked, shows live match preview `matches *.<sub>.<baseDomain>`
  - Auto-unchecks and reverts to false when the user selects a base domain that cannot issue wildcard certs
- "Cancel" and "Add" buttons

### 13.4 Mapping List
- Per-mapping row: protocol badge (blue=http, green=https, purple=tcp) + challenge type badge + optional indigo `wildcard` badge + full domain with path (if set) + lock icon (if basic auth) + arrow + worker name:port + remove button
- Wildcard mappings display the host with a `*.` prefix in the list
- Challenge type badges: none (gray), http (emerald), dns (cyan), selfsigned/self (amber)

### 13.5 Protocol Interactions
- Switching to TCP hides Basic auth and path input
- Switching back from TCP restores Basic auth and path input
- Checking Basic auth reveals username/password fields

### 13.6 Self-Signed CA Certificate
- "CA cert" download button shown when any base domain uses `selfsigned` challenge type
- Downloads PEM file (`agentor-ca.crt`) via `GET /api/domain-mapper/ca-cert`
- User must trust this CA in their browser/OS to avoid TLS warnings
- Self-signed domains use wildcard certificates signed by this CA
- Per-wildcard-host certs (`sub.domain.com` with SAN `*.sub.domain.com`) are auto-generated on demand the first time a wildcard mapping targets that host, and reused for subsequent mappings

### 13.7 Wildcard routing
- A mapping with `wildcard: true` matches both the exact host (`sub.domain.com`) and any single-label prefix (`anything.sub.domain.com`), modelling DNS/TLS wildcard semantics. Deeper nesting (`a.b.sub.domain.com`) is intentionally not matched because a wildcard certificate for `*.sub.domain.com` does not cover it.
- Supported on all three protocols:
  - **HTTP**: router rule is `Host(\`h\`) || HostRegexp(\`^[^.]+\.h$\`)`.
  - **HTTPS**: same host clause as HTTP plus the wildcard cert config.
  - **TCP**: router rule is `HostSNI(\`h\`) || HostSNIRegexp(\`^[^.]+\.h$\`)`. Because SNI is a TLS concept, TCP wildcard is only meaningful on base domains that have TLS — i.e. `:dns:provider` or `:selfsigned`. `:none` cannot do TCP at all (no SNI) and `:http` is rejected like for HTTP/HTTPS.
- Wildcard is a modifier on the routing key `(subdomain, baseDomain, path, protocol)`; two mappings cannot share the same key regardless of wildcard flag.
- Exact-host mappings win over wildcards — wildcard routers are given explicit low priority so a dedicated mapping for `foo.sub.domain.com` always beats the wildcard on `sub.domain.com`.
- Allowed for challenge types: `none` (plain HTTP, no cert), `dns` (router requests `{ main: host, sans: ['*.host'] }` — one cert, `host` is the only name in CT log entries besides the wildcard SAN), and `selfsigned` (locally issued wildcard cert).
- Rejected with 400 for challenge type `http` — HTTP-01 ACME cannot issue wildcard certificates, and issuing on demand for every possible child would leak all subdomains to Certificate Transparency logs.
- Also works on the bare base domain (empty subdomain): `*.domain.com` routes all subdomains of the base domain to one worker.

---

## 14. Usage Panel

> Per-user. The panel shows only the signed-in user's usage. `/api/usage` and `/api/usage/refresh` both require an authenticated session (return 401 otherwise) and are scoped to `requireAuth(event).user.id`. The orchestrator polls each user that has OAuth credentials independently.

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
- Per-image row: image name (orchestrator, worker, traefik)
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
- VS Code Tunnel (custom status/control pane)
- Apps (app instance management)
- Logs (centralized log viewer)

Every pane type supports **multiple simultaneous instances**. Clicking the Terminal, Desktop, Editor, VS Code Tunnel, Apps, or Logs action button opens a brand-new tab each time — the same (container, type) pair can be opened any number of times and arranged side-by-side via the existing drag-to-split interactions. Each tab has its own unique id, independent xterm.js instance, iframe, or component state; backing services (tmux window attach, noVNC, code-server, VS Code tunnel status polling, app instance polling, log stream) already tolerate multiple concurrent clients so no additional reconciliation is required. Closing one tab does not affect sibling tabs of the same type.

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
- Font: Menlo / Cascadia Code / Fira Code / JetBrains Mono (14px)
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

### 18.3 VS Code Tunnel
- Custom pane (not iframe-based, tab type `vscode`)
- Opens via "VS Code Tunnel" button on container card (radio-tower icon)
- Stopped state: radio-tower icon + "VS Code Tunnel is not running" + "Start Tunnel" button
- Auth required state: key icon + "GitHub Authentication Required" + clickable auth URL + large monospace device code (copyable) + "Waiting for authentication..." spinner
- Running state: green pulsing dot + "Tunnel connected" + machine name (monospace) + connection instructions (4 numbered steps) + "Stop Tunnel" button
- Status polled every 3 seconds via `GET /api/containers/:id/vscode-tunnel/status`
- Start/stop via POST endpoints
- Auth persists per worker in agent-data volume (`~/.vscode`) — survives restarts, rebuilds, archive/unarchive

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
- Opens as a split pane tab (type "logs"). Clicking the button again opens an additional independent Logs tab so multiple log panes can be viewed side-by-side. Each instance shares the underlying log stream but can be placed in its own pane group.
- Tab shows "Logs" label with scroll-text icon

### 23.2 Filter Bar
- Source filter buttons: Orch, Worker, Traefik (toggle each source on/off)
- Level filter buttons: DBG, INF, WRN, ERR (toggle each level on/off)
- When no filters active, all entries shown (buttons appear inactive)
- Active filter button shows accent border color
- Search input with 300ms debounce — filters entries by message substring

### 23.3 Log Entries
- Each entry shows: timestamp (HH:MM:SS.mmm) + level badge + source badge + source ID (for container logs) + message
- Level badges color-coded: debug (gray), info (blue), warn (amber), error (red)
- Source badges color-coded: orchestrator (purple), worker (green), traefik (orange)
- Source ID shows display name or container name (hidden for orchestrator entries)
- Error-level entries: red text
- Warn-level entries: amber text
- Hover highlights entry row
- Empty state: "No log entries" / "No log entries matching filters"

### 23.4 Auto-scroll
- Auto-scrolls to bottom when new entries arrive (driven by an explicit live tick from the WebSocket — pagination prepends never trigger an unwanted jump to the bottom)
- Manual scroll up disables auto-scroll
- Scrolling back to bottom re-enables auto-scroll
- Auto-scroll toggle button in filter bar
- On first paint, the pane snaps to the bottom once entries arrive

### 23.5 Lazy load (scroll-up history)
- The full log history is browsable by scrolling up — the viewport is not capped at the initial page
- When the user scrolls within ~80px of the top, the next older page is fetched via `GET /api/logs?until=<oldest visible timestamp>&limit=500`
- The fetch is debounced via a `loadingMore` flag so concurrent triggers do not stack
- After the older entries are prepended, scroll position is anchored to the same content (the user does not jump) by adjusting `scrollTop` by `scrollHeight` delta
- A spinner ("Loading older entries…") shows at the top of the pane while a page is in flight
- A dashed "Beginning of logs" marker is shown when no further history exists
- Filters are applied both server-side (so paginated fetches only return matching entries) and client-side (so live WebSocket entries are gated immediately). Changing filters refetches the most recent matching page from scratch.

### 23.6 Actions
- Clear button: clears all log files (with confirmation dialog)
- Status bar: green/red connection dot + "Connected"/"Disconnected" text + entry count

### 23.7 Live Streaming
- WebSocket connection to `/ws/logs` for real-time log entries
- Auto-reconnect on disconnect (3s delay)
- History loaded from REST API on mount (500 most recent entries)
- Client-side soft cap of 50,000 entries — older entries are evicted only while the user is at the bottom (auto-scroll on); when scrolled into history, eviction is paused so the viewport never collapses under the user. Evicted entries are recoverable via scroll-up since they are still on disk.

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
- `DELETE /api/containers/:id` — remove worker (cleans up port/domain mappings, volumes, store)
- `POST /api/containers/:id/rebuild` — rebuild worker (destroys and recreates with latest image, preserves workspace, agents, and DinD volumes plus metadata — equivalent to archive + unarchive)
- `POST /api/containers/:id/archive` — archive (port/domain mappings are preserved and reattach to the new container on unarchive)
- `POST /api/containers/:id/rebuild` — rebuild worker (port/domain mappings are preserved; their `workerId` field is reassigned to the new container automatically)
- Port and domain mappings survive stop/restart, archive/unarchive, and rebuild. Mappings are only removed on permanent delete (`DELETE /api/containers/:id` or `DELETE /api/archived/:name`).
- `GET /api/containers/:id/logs` — logs with optional ?tail=N (default 200, max 10000)
- `GET /api/containers/:id/workspace` — download workspace .tar.gz
- `POST /api/containers/:id/workspace` — upload files (multipart, path traversal protection)
- `GET /api/containers/:id/desktop/status` — desktop service status
- `GET /api/containers/:id/editor/status` — editor service status
- `GET /api/containers/:id/vscode-tunnel/status` — VS Code tunnel status (stopped, auth_required, running, machineName, authUrl, authCode)
- `POST /api/containers/:id/vscode-tunnel/start` — start VS Code tunnel
- `POST /api/containers/:id/vscode-tunnel/stop` — stop VS Code tunnel

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
- `POST /api/domain-mappings` — create (subdomain, baseDomain, path, protocol, wildcard, workerId/workerName, internalPort, basicAuth)
- `POST /api/domain-mappings/batch` — batch create (single Traefik reconcile). Accepts `wildcard` per item.
- `DELETE /api/domain-mappings/:id` — remove (idempotent)
- `GET /api/domain-mapper/status` — enabled flag, baseDomains list, baseDomainConfigs (domain + challengeType + optional dnsProvider), hasSelfSignedCa flag, dashboard URL
- `GET /api/domain-mapper/ca-cert` — download self-signed CA certificate PEM (404 when no selfsigned domains)
- Validations: protocol http/https/tcp, HTTPS/TCP require TLS, subdomain format, path format (must start with /), path not allowed for TCP, port range, duplicate 409 (subdomain+baseDomain+path+protocol), protocol conflict 409, wildcard rejected 400 when base domain uses HTTP-01 ACME (`challengeType === 'http'`)

### 24.7 Environments
- `GET /api/environments` — list all
- `POST /api/environments` — create
- `GET /api/environments/:id` — get single
- `PUT /api/environments/:id` — update
- `DELETE /api/environments/:id` — delete
- Built-in "default" environment: cannot edit/delete

### 24.8 Capabilities
- `GET /api/capabilities` — list all
- `POST /api/capabilities` — create custom
- `GET /api/capabilities/:id` — get single
- `PUT /api/capabilities/:id` — update custom
- `DELETE /api/capabilities/:id` — delete custom
- Built-in capabilities: port-mapping, domain-mapping, usage, tmux

### 24.9 Instructions
- `GET /api/instructions` — list all
- `POST /api/instructions` — create custom
- `GET /api/instructions/:id` — get single
- `PUT /api/instructions/:id` — update custom
- `DELETE /api/instructions/:id` — delete custom
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
- `GET /api/settings` — orchestrator-wide settings (Docker, Worker Defaults, Git Providers (clone domains only), Network, Init Scripts, App Types). The old `agent-auth` section is removed — agent API keys live per user under `/api/account/env-vars`.
- `GET /api/orchestrator-env-vars` — orchestrator-wide env vars (BASE_DOMAINS, DASHBOARD_*, ACME_EMAIL, BETTER_AUTH_*, etc.). Does NOT include `GITHUB_TOKEN` or any `*_API_KEY` — those are per user.
- `GET /api/git-providers` — provider list with the **current user's** token status (per-user `tokenConfigured` boolean comes from their `UserEnvVars`)
- `GET /api/agent-api-domains` — firewall allowlist
- `GET /api/package-manager-domains` — PM domain list

### 24.15a Per-user Account env vars and credentials
- `GET /api/account/env-vars` — returns the current user's `UserEnvVars` `{ githubToken, anthropicApiKey, claudeCodeOauthToken, openaiApiKey, geminiApiKey, customEnvVars[], updatedAt }`. Owner-only — admins do NOT see other users' values via this endpoint.
- `PUT /api/account/env-vars` — upserts the current user's `UserEnvVars`. Partial updates are allowed (omitted fields keep their previous value). `customEnvVars` keys must match `[A-Z_][A-Z0-9_]*`, must not collide with reserved names (`ENVIRONMENT`, `WORKER`, `ORCHESTRATOR_URL`, etc.), and must be unique. Validation failures return 400.
- `GET /api/account/agent-credentials` — returns `[{ agentId, fileName, configured }]` for the current user. `configured` is true when the per-user OAuth file at `<DATA_DIR>/users/<userId>/credentials/<fileName>` contains more than `{}`.
- `DELETE /api/account/agent-credentials/:agentId` — overwrites that agent's per-user OAuth file with `{}` so the next CLI login writes a fresh token. Unknown agent ids return 400.
- **Scoping**: env vars and credentials are strictly per-user. Each user's workers inherit only their own env vars; user A's worker can never read user B's tokens.
- **Worker provisioning**: when a worker is created/rebuilt/unarchived, the orchestrator resolves the worker owner's `UserEnvVars` and bind-mounts that user's three credential files into `/home/agent/.agent-creds/{claude,codex,gemini}.json`.
- **Precedence inside the worker**: agent + git tokens come from `UserEnvVars`; the per-environment `envVars` field is exported by the entrypoint AFTER Docker's env array, so an Environment can override any per-user var (including `GITHUB_TOKEN`).
- **User deletion cleanup**: a background `OrphanSweeper` runs at orchestrator startup and every 10 minutes; it reads the auth DB's user table and prunes any per-user `user-env-vars.json` row, `<DATA_DIR>/users/<userId>/` directory, and usage-state entry whose user is no longer present. Implemented as a timer rather than a middleware so nothing touches better-auth's request pipeline.

### 24.16 Logs
- `GET /api/logs` — query log entries with filters (sources, sourceIds, levels, since, until, limit, search). `since` is **inclusive** (`>=`) and `until` is **exclusive** (`<`) — paginate older by passing the oldest entry's timestamp as `until` to the next call. Returns `{ entries, hasMore }`.
- `DELETE /api/logs` — clear all log files
- `GET /api/log-sources` — list known container log sources
- `WS /ws/logs` — live log stream (JSON-encoded LogEntry per message, read-only)
- The orchestrator's *own* container stdout (Nuxt/Nitro/Vite, framework warnings, unhandled errors) is captured into `orchestrator.log` with `source: 'orchestrator'` and `sourceId` set to the orchestrator container name. Intentional `useLogger()` entries also live in the same file but carry no `sourceId`.
- `since` is inclusive (`>=`); `until` is exclusive (`<`). The asymmetry guarantees that paginating older with `until = currentOldest` never re-returns the boundary entry.
- Worker container logs include `dockerd`, `code-server`, `vscode-tunnel`, `chromium`, and `microsocks` output (each line tagged with a service prefix like `[dockerd]` or `[code-server]`) in addition to the entrypoint's own stdout.
- Container log messages never contain a leading Docker `--timestamps` prefix — the prefix is parsed into the entry's `timestamp` field and stripped from `message` for both TTY (`\r\n`) and non-TTY streams.
- Stdout and stderr of non-TTY containers are demuxed into separate line buffers; stderr lines are tagged `error` regardless of the heuristic level detection.
- Tmux pane output inside workers (interactive shell / agent CLI) is intentionally **not** captured as a container log — it is served over the terminal WebSocket.

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
- Sidebar width (persistence clamp 200–3000, runtime-clamped to 90% of viewport)
- Sidebar collapsed state
- Panel collapse states (archived, portMappings, domainMappings, usage, images, settings)
- Split pane tree (rootNode + focusedNodeId)
- Tmux active windows per container

### 25.3 Graceful Degradation
- Corrupt localStorage: falls back to defaults
- Partial state: fills missing fields with defaults
- Width clamping: below 200 → 200, above 3000 → 3000 (persistence); above 90% of viewport → clamped on load/resize

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

---

## 27. Git Identity

### 27.1 Per-User Git Config
- When a user creates a worker, the worker's `git config --global user.name` and `user.email` are set from the creating user's profile (name and email from the auth system)
- The `WORKER` JSON env var includes `gitName` and `gitEmail` fields
- The entrypoint reads these fields via `jq` and calls `git config --global`
- `ContainerInfo` and `WorkerRecord` include `gitName` and `gitEmail` fields
- Git identity persists across rebuild (stored in WorkerRecord, re-passed in WORKER JSON)
- Git identity persists across archive/unarchive (same mechanism)
- No per-agent git wrapper — agent CLIs add `Co-authored-by` trailers to their commits for attribution
- No `/usr/local/bin/git` wrapper installed — `git` resolves to `/usr/bin/git` directly
