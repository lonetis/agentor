# Agentor — Comprehensive Feature List

Every user-facing feature of the Agentor web dashboard, organized by category. This document drives the Playwright test suite — every item below must have test coverage.

---

## 0. Authentication & Authorization

### 0.1 First-run Setup
- `/api/setup/status` is public and returns `{ needsSetup, passkeysEnabled, mcpUrl }` (`mcpUrl` = the OAuth-protected MCP server URL, or `null` when MCP is disabled)
- When no users exist, navigating to any dashboard URL redirects to `/setup`
- Setup page shows the Agentor mark above the "Welcome to Agentor" heading and asks for name, email, password, confirm password
- Password must be at least 8 characters; passwords must match
- `/api/setup/create-admin` creates the first user with role = `admin`, auto-signs them in, and redirects to `/`
- Once any user exists, `/api/setup/create-admin` returns 409
- Setup page redirects to `/login` when setup is already complete

### 0.2 Login
- Navigating to any protected URL while unauthenticated redirects to `/login`
- Login page renders the Agentor mark above the "Agentor" / "Orchestrator" heading, email + password fields and a Sign in button
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
- Every resource shares a consistent, extensible base shape — `id` (UUID v4), `createdAt`, `updatedAt` — and user-owned resources additionally carry `userId` (a shared `BaseResource` / `UserOwnedResource` in `orchestrator/shared/types.ts`). New optional fields can be added later without breaking the base.
- Workers, port mappings, domain mappings, environments, capabilities, instructions, init scripts all carry a `userId`
- Built-in capabilities/instructions/init-scripts/environments have `userId: null` (a `builtIn` flag) and are visible to all users. Their `id` is a stable UUID **deterministically derived from the slug (filename)** — the filename is the `name`, the id is a derived UUID (RFC 4122 v5), so it stays constant across the every-startup re-seed (a random id per boot would orphan references like a worker's `environmentId`). User-created entries get random UUIDs.
- better-auth is configured with `advanced.database.generateId: 'uuid'`, so user/session/account ids minted for NEW records are UUIDs (existing rows keep their original ids)
- Regular users cannot see or modify another user's resources (403 on mutations, filtered out of list responses)
- Admins can see and modify everything
- Port/domain mappings inherit the `userId` of the target worker

### 0.6 Admin-only Endpoints
- `GET /api/settings` — 403 for non-admin
- `GET /api/logs`, `DELETE /api/logs`, `GET /api/log-sources`, `WS /ws/logs` — admin-only (log sources expose worker container names)
- `POST /api/updates/apply`, `/check`, `/prune` — admin-only

### 0.7 System Tab (Admin Only)
- The sidebar System tab (Images card, Logs button, System Settings button, Users button, API Docs link) is only shown to admin users — every action inside it hits an admin-only endpoint. Regular users do not see the System tab at all.

### 0.8 Users Modal (Admin Only)
- "Users" button appears in the sidebar System tab Quick Links for admins only
- Modal lists all users with role badge and current-user indicator
- Create user form (name, email, password, role)
- Change role action (promote to admin / demote to user)
- Delete user action (with confirmation)
- Backed by the `/api/users` REST API (§24.19) — the same routes the MCP user tools use; errors (e.g. duplicate email, demoting yourself) are shown in the modal (`role="alert"`)
- On phones each row's actions (Make admin / Demote, Reset password, Delete) wrap onto their own right-aligned line

### 0.9 Account Card
- Sidebar footer (pinned to bottom, always visible across tabs) shows the current user's avatar, name, email, admin badge, and a Sign out icon button (between them the PWA install button when the app can be installed, §1.7)
- Clicking the user info (avatar/name/email area) opens the Account modal

### 0.9b Account Modal (self-service)
- Accessible from the sidebar footer by clicking the user info area; the dialog is named "Account settings" and is a full-screen sheet on phones (its Close button stays reachable)
- **Profile section**: edit name and email, Save button. Email changes apply immediately (no verification email sent — Agentor does not send email).
- **Change password section**: current password + new password (min 8 chars) + confirm new password. Server rejects the wrong current password.
- **Environment variables**: stored per user as a single uniform list of `{key, value}` pairs keyed by the env var NAME (no hardcoded fields). The modal splits this into two sections that share one **"Save env vars"** button (`PUT /api/account/env-vars`, which replaces the whole list):
  - **Predefined environment variables section**: one masked password input (show/hide eye toggle) per key in `PREDEFINED_ENV_VAR_KEYS` (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) **plus every git provider's token variable** from `/api/git-providers` (so each self-managed GitLab in `GITLAB_INSTANCES` adds a `GITLAB_<NAME>_TOKEN` input), each labeled by the env var NAME (e.g. "GITHUB_TOKEN", not "GitHub token"); provider token inputs carry a hint naming the provider (e.g. "GitLab (acme) token"). Providers load before the stored env vars are split, so a saved provider token always shows in its predefined slot, never as a custom row. This list is purely a UI affordance — adding a key to `PREDEFINED_ENV_VAR_KEYS` in `orchestrator/shared/types.ts` adds an input, nothing else.
  - **Custom environment variables section**: list of `{key, value}` rows with Add/Remove for any other env var. Keys validated `[A-Z_][A-Z0-9_]*`; reserved names (`ENVIRONMENT`, `WORKER`, `ORCHESTRATOR_URL`, etc.) and duplicates are rejected with an inline error. On phones a row stacks (KEY full width, value + buttons below).
  - Eye toggles are named "Show <KEY>" (predefined) / "Show value" (custom) and expose `aria-pressed`; the custom remove button is "Remove variable"; KEY / value / SSH inputs have autocapitalize / autocorrect / spellcheck off
  - All inputs (predefined + custom) are serialized into one `envVars` list and injected into every worker the user creates.
- **SSH Access section**: `sshPublicKey` textarea (4 rows, monospace) with its OWN **"Save SSH key"** button hitting `PUT /api/account/ssh-key`. The SSH key is NOT an env var — on save the key is written only to `<DATA_DIR>/users/<userId>/ssh/authorized_keys` (empty string → empty file), which is bind-mounted read-only at `/home/agent/.ssh/authorized_keys` in every one of the user's workers. Used by the **SSH** app (Apps pane → Start).
- **Agent OAuth credentials section**: per-agent (claude/codex/antigravity) status indicator (`Logged in` green / `Not logged in` gray) plus a per-agent **Reset** button (two-step confirm) that overwrites the OAuth file with `{}` so the next CLI login writes fresh tokens. Login itself happens by running the agent CLI inside one of the user's workers — credentials live at `<DATA_DIR>/users/<userId>/credentials/` and are bind-mounted into all of the user's workers.
- Success (`role="status"`) and error (`role="alert"`) messages displayed per section
- **MCP access section** (last section; hidden when MCP is disabled): the MCP server URL (`<public URL>/mcp`, selected entirely on tap, copy button — works on plain-http LAN origins too, shows a check mark for 1.5s, or the toast "Copy failed — select the URL and copy it manually") with a `claude mcp add --transport http agentor <url>` example, and the list of **authorized applications** (OAuth clients the user approved: name, authorization date, scopes) each with a two-step **Revoke** (`Revoke` → `Confirm revoke`) that removes the app's consent and tokens; "No applications authorized." when empty
- Backed by `/api/auth/update-user`, `/api/auth/change-email`, `/api/auth/change-password` (built-in better-auth) and Agentor's per-user `/api/account/env-vars`, `/api/account/ssh-key`, `/api/account/agent-credentials`, and `/api/account/oauth-apps` endpoints

### 0.9c Admin Password Reset
- In the Users modal each row except your own has a "Reset password" button that prompts for a new password and calls `PUT /api/users/:id/password`
- No current password required — only admins can invoke this endpoint

### 0.10 WebSocket Authentication
- All `/ws/terminal/:id[/:windowIndex]` connections require a valid session cookie and container ownership
- `/ws/desktop/:id`, editor proxy, and log stream WebSocket endpoints reject unauthenticated peers

### 0.11 Layered Auth
- Traefik dashboard basic auth (`DASHBOARD_AUTH_USER`/`PASSWORD`) still works as an additional layer in front of the orchestrator; user auth is independent

### 0.11a CSRF / Origin enforcement
- better-auth's `/api/auth/*` endpoints reject mutating requests without a trusted `Origin`
- Every other `/api/*` request that changes state (anything but GET / HEAD / OPTIONS) and is authenticated by the session cookie must carry an `Origin` from the trusted-origins list; otherwise 403 `Forbidden: untrusted request origin`. This stops same-site pages (e.g. a worker's domain mapping on the dashboard's base domain) from submitting forms to the API with the SameSite=Lax cookie. Worker-self routes (no cookie) and MCP tool calls (internal capability) are unaffected

### 0.12 Passkey (WebAuthn) Authentication
- **Conditional enablement**: Passkeys are only available when the dashboard is served over Traefik with both `DASHBOARD_SUBDOMAIN` and `DASHBOARD_BASE_DOMAIN` set. When disabled, the passkey plugin is not registered at all and every passkey UI element is hidden via the `passkeysEnabled` flag on `GET /api/setup/status`. WebAuthn config (when enabled): `rpID = <subdomain>.<base>` (override with `BETTER_AUTH_RP_ID`), `origin = https://<subdomain>.<base>`, `rpName = 'Agentor'`. Users must access the dashboard via the Traefik URL for passkey flows to work. Without a Traefik dashboard, passkeys are also enabled when `BETTER_AUTH_URL` is an `https://` URL (the dashboard sits behind an existing reverse proxy at a stable HTTPS origin): `rpID = <its host>` (or `BETTER_AUTH_RP_ID`), `origin = <its origin>`.
- **Setup page** has a Password / Passkey toggle (only shown when passkeys are enabled; the buttons expose `aria-pressed`). The Passkey path creates the initial admin via `POST /api/setup/create-admin-passkey-token` and `client.passkey.addPasskey({ context: token })` — no password required.
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

### 0.13 OAuth 2.1 for MCP clients (consent + login continuation)
- better-auth acts as an OAuth 2.1 authorization server for MCP clients (details in §29): authorization code + PKCE (S256), refresh tokens, Dynamic Client Registration and Client ID Metadata Documents
- **Consent page** `/oauth/consent`: reached from `/api/auth/oauth2/authorize` with a signed query; shows the Agentor mark above the "Agentor" heading, "Authorize <client name>", the signed-in email, the origin approval redirects to (so look-alike client names can be spotted), and each requested scope with a description (`agentor` = full control of the account). **Approve** redirects back to the client's redirect URI with `code` + `state`; **Deny** redirects with `error=access_denied`. Visiting the page without a signed query shows an error and disabled buttons
- **Login continuation**: a signed-out user starting an authorization is sent to `/login?<signed query>`, which shows "Sign in to authorize an application to access your Agentor account."; after email/password or passkey sign-in the authorization continues to the consent page (not the dashboard). With a signed query the login page does not auto-redirect a signed-in user to `/`; a signed-out visit to the consent page is redirected to `/login` with the signed query preserved, so signing in resumes the authorization
- Apps a user authorized are listed / revocable in the Account modal (§0.9b)

---

## 1. Dashboard Layout

### 1.1 Page Structure
- Page loads with the Agentor mark, "Agentor" title and "Orchestrator" subtitle
- Browser title contains "Agentor"
- Left sidebar + main content area layout
- Main content area shows placeholder when no panes are open ("Create a worker from the sidebar to get started") on the terminal background, with a **Create worker** button (icon plus) that opens the New Worker modal (shared state with the sidebar's "+ New Worker")
- Floating hamburger button appears when sidebar is collapsed (see §2.2)
- A "Skip to panes" link (visible on keyboard focus) jumps to the pane area (`<main id="main-content">`)
- Landmarks: `<aside aria-label="Sidebar">`, `<nav aria-label="Sidebar sections">`, `<main>`; login, setup and OAuth consent pages also use one `<main>` landmark (with `min-h-dvh` and safe-area padding)
- Primary colour is blue and neutrals are gray (Nuxt UI app config); in light mode solid primary elements use the 600 shade for contrast
- Worker lifecycle actions (stop, restart, rebuild, remove, archive, save settings, unarchive, delete archived, create) ignore repeated clicks while one is running for that worker (the card shows a busy spinner, §4.1) and report failures as an error toast ("<Action> failed" + the server message) instead of failing silently; the native confirm dialogs are unchanged

### 1.2 Sidebar Header
- Agentor mark (`AppLogo`, `data-testid="agentor-logo"`, decorative `alt=""`) beside the "Agentor" heading with "Orchestrator" subtitle — the heading stays a real `<h1>` text
- ThemeToggle component (3 buttons: System/Light/Dark)
- Collapse sidebar button (double-chevron icon, `aria-expanded="true"`)
- Landscape phones (height ≤ 500px): compact header — less padding, no "Orchestrator" subtitle, smaller mark

### 1.3 Sidebar Action Buttons
- "+ New Worker" button opens create worker modal
- "Import worker" icon button (`aria-label="Import worker"`, icon `i-lucide-import`, next to New Worker) opens the Import Worker modal (§28)
- "Environments" button opens environments modal
- "Capabilities" button opens capabilities modal
- "Instructions" button opens instructions modal
- "Init Scripts" button opens init scripts modal
- The Capabilities / Instructions / Init Scripts trio sits on one row while the sidebar is wide; once the sidebar is narrower than ~280px the row stacks the three buttons vertically so their labels never get truncated

### 1.4 Sidebar Sections (all collapsible with chevron toggle)
- **Workers** — list of non-stopped container cards (running / creating / error / removing). Badge counts non-stopped workers only.
- **Stopped** — list of `status === 'stopped'` container cards; sits between Workers and Archived. Mutually exclusive with Workers (a stopped worker shows here, not in Workers), mirroring Archived. Uses the same `ContainerCard` (Restart button instead of Stop, view/workspace buttons hidden). Empty-state copy "No stopped workers."; badge counts stopped workers. Restarting a stopped worker moves it back to the Workers tab; stopping a running worker moves it here.
- **Archived** — collapsed by default, only shown when archived workers exist, shows count
- **Port Mappings** — always visible
- **Domain Mappings** — only visible when domain mapper is enabled (BASE_DOMAINS configured)
- **Usage** — always visible, has refresh button
- **Images** — always visible
- **Settings** — always visible, contains "Logs" button, "System Settings" button, and "API Docs" link
- The active section tab carries `aria-current="true"`; empty-state texts and System card headers use higher-contrast grays
- Footer: account card (opens Account settings), the PWA install button (§1.7, only when installable) and Sign out
- Touch screens get larger targets for the section tabs, More button, dropdown items, system links, collapse and sign-out buttons; keyboard focus shows an inset focus ring on tabs, More, dropdown items and system links

### 1.5 Sidebar Tab Bar Overflow
- All tab buttons (Workers / Stopped / Archived / Ports / Domains / Usage / System) are rendered in a horizontally scrollable row
- The scrollbar itself is hidden for a clean look; scrolling still works via mouse wheel (vertical wheel is converted to horizontal scroll), trackpad, and keyboard
- When one or more tabs have less than 20% of their width visible inside the scroll viewport, a "More" chevron button pins to the right edge with a gradient fade and opens a dropdown listing those (mostly) hidden tabs
- A tab with at least 20% of its width visible stays out of the dropdown — this gives a small hysteresis zone so tabs don't pop in and out while scrolling past them
- Scrolling the tab bar updates the dropdown live — tabs that become visible drop out, tabs that scroll off join
- Once the sidebar is wide enough that every tab is fully visible (or at least 20% visible after scrolling), the "More" button disappears entirely
- The More button is named "More tabs" with `aria-haspopup` / `aria-expanded`; the dropdown closes on an outside tap / click and on Escape, which returns focus to the More button (and does not also close the phone overlay)
- The active tab is scrolled into view on load (e.g. a persisted active tab past the right edge after a reload) and whenever it changes (e.g. picked from the More dropdown)


### 1.6 Branding & Favicon
- Every page links the favicon set from `<head>`: `favicon.ico` (16–256 px embedded sizes), `favicon-16x16.png` / `favicon-32x32.png` / `favicon-48x48.png`, `apple-touch-icon.png` (180×180) and the web manifest `site.webmanifest`
- The icon files, `android-chrome-192x192.png` / `android-chrome-512x512.png`, `maskable-icon-192x192.png` / `maskable-icon-512x512.png` and the manifest are served from the site root (`orchestrator/public/`); the manifest names the app `Agentor`, uses `#030712` as theme/background colour, `id` / `scope` / `start_url: /`, and lists four icons: the two android-chrome icons (`purpose: any`) and the two maskable icons (`purpose: maskable`); every icon is a PNG whose pixel size matches its `sizes`
- Exactly one `theme-color` meta tag, which follows the colour mode: `#f9fafb` in light mode, `#030712` in dark mode (§1.7)
- The README shows the full wordmark logo (`docs/assets/agentor-logo-light.png`, dark variant via `<picture>`); it is not part of the app

### 1.7 Progressive Web App
- **Installable**: `site.webmanifest` describes a standalone app (`id` / `scope` / `start_url` `/`, `display: standalone`, `orientation: any`, `#030712` background / theme, `launch_handler` `focus-existing`) with `any` and `maskable` icons (no white frame on Android adaptive icons). The manifest link is sent with credentials (`crossorigin="use-credentials"`), so installing works behind the dashboard's basic auth
- **Head metadata**: `<html lang="en">`; one viewport meta `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content` (pinch-zoom allowed — no `maximum-scale` / `user-scalable`); `application-name`, `mobile-web-app-capable` and `apple-mobile-web-app-capable` (`yes`), `apple-mobile-web-app-title` `Agentor`, `apple-mobile-web-app-status-bar-style`, `format-detection` `telephone=no`
- **Theme colour**: exactly one `theme-color` meta that switches with the colour mode (`#f9fafb` light / `#030712` dark)
- **Service worker** (`/sw.js`): registered at scope `/` only in production builds on a secure context (HTTPS or localhost); `<html data-pwa-sw>` reports `registered`, `dev` (dev server — our worker is unregistered), `insecure` (plain http on a LAN address — no worker, no install), `unsupported` or `failed`. It caches only `offline.html` and answers only top-level page navigations (network-first); API, WebSocket, editor / desktop proxy, MCP, OAuth discovery, icon and asset requests never go through it
- **Offline / unreachable fallback**: when a page navigation fails (offline) or the proxy answers 502 / 503 / 504 (orchestrator restarting), the worker serves a self-contained page: heading "Agentor is unreachable", "You are offline, or the server is restarting. This page reconnects automatically.", a **Retry** button and the status "Checking again in N s.". It checks `/api/health` every 5s (30s after 3 consecutive reloads within 60s) and on the browser's `online` event, and returns to the dashboard on its own. It follows the colour mode and loads nothing from the server
- `/sw.js`, `/offline.html` and `/site.webmanifest` are served with `cache-control: no-cache` and without a session
- A session check that fails because the server is unreachable (network error / 5xx) shows the offline page instead of redirecting to `/login` (when the worker controls the page); a real signed-out state still goes to `/login`. The offline page's **Retry** returns to the dashboard
- **Install button**: once the browser offers installation (`beforeinstallprompt`), an icon-only **Install app** button appears in the sidebar footer between Account settings and Sign out; clicking it opens the browser's install prompt, after which the button disappears. On iPhone / iPad (not installed) the footer instead shows an **Add to Home Screen** button whose popover says "Tap Share, then Add to Home Screen." with **Dismiss** (hides it for good, `localStorage` `agentor-ios-install-hint-dismissed`). Neither shows when the app runs installed
- **Launches**: launching the installed app focuses the open window; a deep link (e.g. an OAuth authorize URL) navigates that window
- **After an orchestrator self-update** the "Reconnecting..." overlay stays up until the new server answers (after an observed outage, or after ~30s) and the page then reloads itself to load the new client build
- **Launch screen**: until the app has mounted, a full-screen `#030712` (`#f9fafb` in light mode) background with the app icon is shown instead of a blank page
- **Local icons**: lucide icons are served by the orchestrator (`/_nuxt_icon`) and the always-visible chrome icons ship in the client bundle; the login page and dashboard never request `api.iconify.design`
- **iOS home-screen app**: keeps its own cookies (sign in again inside the app); the Desktop / Editor panes hide "Open in tab" there (§18)

### 1.8 Phones, touch & keyboard
- The whole dashboard is sized to the visible viewport (follows the soft keyboard) and padded for the notch / home indicator
- **Modal sheets**: below 640px every modal (New Worker, Worker Settings, Upload, Account settings, Environments, Capabilities / Instructions / Init Scripts, System Settings, Users, Import Worker) fills the visible viewport; action rows (Create / Cancel, Save / Save & Rebuild, Import, Upload, Update, Close …) are sticky at the bottom and always on screen. Desktop modals are unchanged
- **Dialog names**: every modal is named by its heading (`getByRole('dialog', { name: 'New Worker' | 'Account settings' | 'Environments' | 'Capabilities' | 'Instructions' | 'Init Scripts' | 'System Settings' | 'Users' | 'Import Worker' | 'Upload to Workspace' | '<name> — Settings' })`)
- No double-tap-zoom delay or grey tap flash on controls, no iOS long-press callout on tabs, and iOS does not zoom the page when focusing a form field (fields are 16px on iOS touch devices); pinch-zoom stays available
- Larger touch targets on coarse pointers (sidebar tabs, links, card / footer / app-row / mapping buttons, filter buttons)
- Technical inputs (repo URL, branch, paths, env vars, scripts, SSH key, domains, ports, CPU / memory) do not autocapitalise, autocorrect or spellcheck; port inputs show a numeric keyboard
- Reduced motion: the sidebar slide, update / status pulses and progress-bar transitions respect `prefers-reduced-motion`
- Errors in forms and panels are announced (`role="alert"`), success messages in Account settings with `role="status"`

### 1.9 Background polling
- Polls pause while the browser tab is hidden or the device is offline; when the page is shown again (or back online), data older than one interval refreshes immediately
- A pane tab hidden behind another tab of its group stops polling (Apps instances 5s, Desktop / Editor status 5s, tmux windows 3s) and refreshes at once when shown again; pane contents stay mounted, so sockets and iframes survive
- The worker list (10s), port mappings (10s), domain mappings (10s), worker metrics (10s) and usage (5 min) each run on one shared poller however many components use them; an unchanged result is not re-rendered, and a failed port / domain mapping poll keeps the last list. Polls never overlap; the app type list is fetched once per page load

---

## 2. Sidebar Resize & Collapse

### 2.1 Resize
- Drag handle at right edge of sidebar
- Width range: 200px minimum to 90% of the current viewport width maximum
- Dragging below the 120px collapse threshold snaps the sidebar closed on release (VS Code-style) while preserving the last valid width for re-expand
- Width persisted to localStorage (persistence clamp 200–3000; runtime re-clamped to 90% of viewport on window resize)
- No width transition while actively dragging — the sidebar tracks the cursor instantly
- Works with mouse, touch and pen (Pointer Events with pointer capture); larger hit area on touch screens
- The handle is a focusable separator (`role="separator"`, `aria-label="Resize sidebar"`, `aria-valuenow` = width, `aria-valuemin`); ArrowLeft / ArrowRight shrink / grow the sidebar by 16px and persist the width
- Not shown in the mobile layout (§2.2)

### 2.2 Collapse/Expand
- Collapse button (double-chevron) hides sidebar
- Expand button (`title="Expand sidebar"`, `aria-expanded="false"`, 32px) restores sidebar. It sits at the top-left inside the first pane tab bar; while the sidebar is collapsed that tab bar is padded 40px on the left (`--pane-leading-inset`), so the button never covers the first tab
- Collapse state persisted to localStorage across reloads
- A collapsed sidebar is `inert` (not in the tab order). Collapsing moves focus to the Expand button, expanding to the Collapse button
- **Mobile layout** — viewport narrower than 768px, or a touch screen at most 500px high (landscape phones): the sidebar starts collapsed (transient, not persisted) and opens as an overlay `min(320px, 100vw − 56px)` wide, sized to the visible viewport (follows the soft keyboard, clears the notch / home indicator), with a shadow and a strip of backdrop
  - Closes on a backdrop tap, on Escape (unless a dialog is open — the dialog closes first and the overlay stays) and whenever a pane opens (Terminal / Desktop / Editor / Apps / Logs, also after create, import and rebuild)
  - While it is open the pane area is `inert`; when it closes because a pane opened, focus moves to the Expand button only if it was inside the overlay
  - A modal opened from the overlay is painted on top of the overlay

### 2.3 Panel Collapse States
- Each panel section (Archived, Port Mappings, Domain Mappings, Usage, Images, Settings) independently collapsible
- Panel states persisted to localStorage
- Panel re-expand persists across reload
- Multiple panel states persist independently

---

## 3. Theme System

### 3.1 Toggle
- Three-way toggle: Default (system), White (light), Dark (dark)
- Icons (lucide): monitor (default), sun (light), moon (dark)
- Active button highlighted with shadow
- Buttons are named "Default theme", "White theme", "Dark theme" (tooltips Default / White / Dark); only the active one has `aria-pressed="true"`; larger touch targets on touch screens
- Default preference: dark
- The browser / installed-app title bar colour (`theme-color`) follows the mode (§1.7)

### 3.2 Persistence
- Theme preference persisted across reloads via @nuxtjs/color-mode
- Terminal themes switch reactively (DARK_THEME / LIGHT_THEME)
- CSS custom properties for pane tabs, terminal area, scrollbars

---

## 4. Container Cards (Worker Cards in Sidebar)

### 4.1 Card Content
- Display name (`displayName` in an `<h3>`, truncated with an ellipsis and the full name as title tooltip; falls back to `shortName(id)` only if the label were ever empty). A long name never pushes the status badge out of the card — the badge group always stays visible on the right, and the header does not scroll. The display name is free-form (spaces / mixed case allowed) and is NOT the worker's internal identity — the internal `id` is an immutable UUID v4.
- Status badge: running (green), stopped (neutral), creating (warning), error (error), removing (warning); `creating` and `removing` show a spinning loader icon
- While a lifecycle action for the worker is in flight (§1.1), a spinner (`role="img"`, `aria-label="Working"`) appears next to the status badge; no buttons are disabled
- Short image ID in monospace (first 10 chars, higher-contrast gray)
- Active card: blue-tinted background with blue border and shadow
- Clicking name/status area opens detail modal

### 4.1b Per-worker live metrics
- All per-worker metrics are derived **entirely through the Docker API** (no host `/proc`/`statfs`), so they behave identically across OSes and runtimes (Docker Desktop, Linux, etc.).
- When the worker is running, a compact metrics row (`data-testid="worker-metrics"`) shows live **CPU %** (of total host, from `docker stats`), **RAM** used bytes (limit in the tooltip — no percentage), **Disk** used bytes (the container's writable filesystem layer + its `/workspace` + agent data), and network throughput (↓ down / ↑ up). CPU/RAM colorize green/amber/red by threshold (<50 / 50-79 / ≥80).
- Sampled once in the sidebar via `useWorkerMetrics()` (one 10s poll → `GET /api/worker-metrics`) and passed to each card as a `metric` prop (no per-card polling). cpu/mem/net come from `container.stats` on a 3s server cadence. Disk is sampled server-side on a slower (60s) cadence — the container's writable-layer size (Docker `SizeRw`, which excludes the base image) plus a `du` of its `/workspace` + agent-data volumes (so it works in both volume and directory storage modes; the DinD image store is excluded). 0 until first sampled; `POST /api/worker-metrics/refresh` forces an immediate sample.
- Hidden when the worker is not running or has not been sampled yet.

### 4.1a Settings Pencil
- A "Settings" pencil button (icon `i-lucide-pencil`, wrapped in `<UTooltip text="Settings">`) sits in the card's action button row
- Clicking it (or clicking the card title) opens the editable **Worker Settings modal** (§5) — there is no inline-on-card rename input anymore; renaming and all other editable settings live in the modal
- When the worker has unsaved rebuild-requiring edits, the card shows an amber `rebuild pending` badge next to the status badge (tooltip "Settings changed — rebuild to apply")

### 4.2 View Buttons (only when running)
- Terminal button (tooltip "Terminal") — opens terminal pane
- Desktop button (tooltip "Desktop") — opens desktop pane
- Editor button (tooltip "Editor") — opens editor pane
- Apps button (tooltip "Apps") — opens apps pane (VS Code Tunnel and SSH are managed as apps inside this pane)
- Upload button (tooltip) — opens upload modal
- Download button (tooltip) — downloads workspace as .tar.gz
- Export button (tooltip "Export worker", icon `i-lucide-package`) — sits in the **workspace** group right next to Download Workspace (so running-only). While the bundle is being prepared it shows a spinner and is disabled (tooltip reads "Preparing export…"), then downloads a full worker export bundle (see §28)
- Every icon button's accessible name equals its tooltip text: Terminal, Editor, Desktop, Apps, Upload to Workspace, Download Workspace, Export worker / Preparing export…, Settings, Restart / Stop, Rebuild, Archive, Remove; the group dividers are hidden from assistive tech

### 4.2a Action row layout
- All action buttons are **left-aligned** (no right-side spacer) and organised into logical groups separated by thin vertical divider lines: **views** (terminal/editor/desktop/apps) | **workspace** (upload/download/export) | **lifecycle** (settings/restart-or-stop/rebuild) | **destructive** (archive/remove). The views + workspace groups appear only when running; lifecycle + destructive are always present (no dangling leading/trailing dividers).
- The row (`.card-actions`) is a single non-wrapping flex strip with `overflow-x: auto` and a hidden scrollbar; when the sidebar/card is too narrow it scrolls horizontally. A vertical mouse-wheel over the row scrolls it horizontally.
- On touch screens (coarse pointer) the row wraps onto several lines instead of scrolling, with larger (≈36px) buttons.
- The Worker Settings and Upload modals are created only when first opened (not per card on every list refresh)

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

## 5. Worker Settings Modal

The worker "detail" view is a fully editable **Worker Settings modal** (no more read-only view). It shows only worker-related settings — environment-specific settings (CPU/memory, network, Docker, capabilities, instructions, setup script, env vars, exposed APIs) live in the Environments modal, not here.

### 5.1 Content
- Header: `<displayName> — Settings` + status badge (color-coded) + an amber `Rebuild pending` badge when there are unapplied rebuild-requiring edits; the dialog is named by this heading
- Pending-rebuild banner (only when `pendingRebuild`): "Settings changes are saved but not yet applied. Rebuild the worker to apply them." + a "Rebuild now" button
- **Worker** section (read-only identity): Worker ID (the immutable worker UUID `container.id`, monospace), Container ID (the Docker `container.containerId`, first 12 chars), Image (`container.imageName`), Image ID (first 12 chars), Created timestamp
- **Settings** section (editable):
  - **Display name** — `<input>` with a `<label for>`, tagged `no rebuild needed` (applied without a rebuild)
  - **Environment** — `<select>` of available environments (labelled), tagged `requires rebuild`
  - **Repositories** — RepoInput rows + "+ Add repository" in a labelled group (`role="group"`), tagged `requires rebuild`
  - **Volume Mounts** — MountInput rows + "+ Add mount" in a labelled group, tagged `requires rebuild`
  - **Init Script** — preset `<select>` (labelled "Init Script") + textarea named "Init script content" (no autocorrect / autocapitalize / spellcheck; synced via `useInitScriptSync`), tagged `requires rebuild`
- **Info** sections (read-only, shown only when present, reloaded every time the modal opens): Port Mappings (`:<external>` → `:<internal>` with an `internal` (blue) / `external` (orange) type label like the Ports panel), Domain Mappings (full host — `*.` prefix for wildcard mappings, a bare base domain without a leading dot, plus the path — and a `wildcard` badge), App Instances
- Section headings are small uppercase gray labels
- The banner and the save row wrap on narrow screens (the "Changes require a rebuild…" hint takes its own line on phones); below 640px the modal is a full-screen sheet with a sticky save row

### 5.2 Settings editing tiers
- **Live** — `displayName`. Saving applies it to the running worker immediately (the `PATCH` updates the stored label and in-memory state; no recreation).
- **Requires rebuild** — `environmentId`, `repos`, `mounts`, `initScript`. These are baked into the container at create time (the `WORKER`/`ENVIRONMENT` env JSON and Docker `Binds`), so saving them only updates the stored desired config and flags the worker `pendingRebuild: true`. A rebuild re-resolves from the stored config and applies them.

### 5.3 Save actions
- **Save** — `PATCH /api/containers/:id` with the edited fields. Disabled until a change is made and while the display name is empty/over 100 chars. Live fields apply immediately; rebuild fields are stored + the worker is flagged `pendingRebuild`.
- **Save & Rebuild** — shown only when a rebuild-requiring field changed. Persists the edits, then rebuilds the worker (no extra confirm — the choice is explicit), so the running container immediately reflects the new config. The accompanying hint reads "Changes require a rebuild to take effect."
- **Rebuild now** — in the pending banner; rebuilds to apply already-saved pending edits.
- **Close** — dismisses without saving.

### 5.4 Interactions
- Opens when clicking the worker name or the Settings pencil (§4.1a)
- Close via Escape key or clicking the overlay
- Re-openable; the form re-initialises from the worker each time it opens. An unchanged form never looks dirty (the default environment and a matching init-script preset are filled in once their lists arrive), so Save stays disabled until something changes

---

## 6. Create Worker Modal

### 6.1 Form Fields
- **Display name** — free-form text input (NO keystroke sanitization — spaces and mixed case are preserved), placeholder is a suggested display name fetched from `GET /api/containers/generate-name`. Not required to be unique. The client sends only this value; it does NOT send or choose the internal `name`.
- **Environment** — dropdown selector with "Default" option + "Manage" button (opens environments modal)
- **Repositories** — dynamic list with "+ Add repository" link in a labelled group (`role="group"`, "Repositories"), each row has RepoInput + remove button ("Remove repository")
- **Volume Mounts** — dynamic list with "+ Add mount" link in a labelled group ("Volume Mounts"), each row has MountInput (source "Host path", target "Container path", read-only checkbox — clicking its "ro" label toggles that row's checkbox) + remove button ("Remove mount"); rows wrap on narrow screens
- **Init Script** — preset dropdown (None, claude, codex, antigravity, custom scripts; labelled "Init Script") + "Manage" button (opens init scripts modal) + editable textarea named "Init script content" (3 rows, monospace, no autocorrect / autocapitalize / spellcheck)
- The dialog is named "New Worker" (its heading); on phones (<640px) it is a full-screen sheet with a sticky Create / Cancel row

### 6.2 Init Script Sync
- Selecting a preset populates the textarea
- Editing textarea to match a preset auto-selects it
- Clearing textarea switches to "None"
- Any other edit switches to "Custom"

### 6.3 Repository Input Features
- Git provider dropdown (`aria-label="Git provider"`): GitHub, GitLab (gitlab.com), and one `GitLab (<name>)` entry per self-managed GitLab server in `GITLAB_INSTANCES`
- Provider-agnostic: when the user has a token for the selected provider (its `tokenEnvVar`, e.g. `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITLAB_<NAME>_TOKEN`), the URL field becomes a searchable dropdown (`aria-label="Repository"`) of the provider's repositories — `owner/repo` on GitHub, nested `group/subgroup/project` paths on GitLab — with lock/book icons for private/public, keyboard navigation (ArrowUp/Down/Enter/Escape)
- Create new repo from dropdown (public or private): a bare name goes to the user's own namespace, a path to the namespace before its last segment (`group/sub/name` → GitLab group `group/sub`); a failed create shows the provider's error in the dropdown
- Branch selector (`aria-label="Branch"`), loaded after picking or creating a repo (or when a settings row opens with a repo already set), shows `<default branch> (default)` as placeholder and accepts any typed branch
- Without token: plain text URL input (`aria-label="Repository URL"`, provider-specific placeholder) + plain branch input; a repo path or a full clone URL both work
- Self-contained per row: both the Create Worker and the Worker Settings modals get the full picker; repo lists are shared per provider (refetched after 60s, when the Create Worker modal opens, or after saving env vars), branch state stays with its row (rows have stable keys, so removing an earlier row never mixes up state)
- The searchable dropdown lights up **immediately** after a token is saved in the Account modal — `useGitProviders()` is a refreshable singleton whose `refresh()` is called on a successful env-vars save, so the `tokenConfigured` gate no longer stays stale until a full page reload (regression fix).
- When a token is set but the provider request fails (bad token, missing scopes, rate limit, unreachable instance), the dropdown surfaces the error inline (red row with an alert icon), instead of showing a silently-empty list.
- On phones a row wraps: provider, branch and remove stay on the first line and the repository field takes a full-width line of its own (wider than 200px on a 390px screen); repo and branch inputs have autocapitalize / autocorrect / spellcheck off

### 6.4 Actions
- "Create" button — validates, creates container, auto-opens terminal tab, closes modal, resets form
- "Cancel" button — closes modal
- Escape key — closes modal
- Cross-modal navigation: "Manage" buttons close create modal, open target modal (350ms delay)

### 6.5 Display name & worker identity handling
- The client sends only `{ displayName }` on create — either the value the user typed or, when the field is left blank, the suggestion fetched from `GET /api/containers/generate-name`. It NEVER sends an `id`.
- The orchestrator mints the worker's internal identity itself: an immutable **UUID v4** (`crypto.randomUUID`) stored as `id`. The client cannot choose or influence it. It is stable across rebuild/unarchive.
- `containerName = agentor-worker-<id>`, so the Docker container name looks like `agentor-worker-<uuid>`. There is NO `userId` segment.
- No custom `Hostname` is set on the container, so the in-container `hostname` command (and the shell prompt) returns the Docker short container id (e.g. `16b082a7681b`) — NOT the worker UUID and NOT a friendly label. The friendly, editable label lives only in `displayName` and only ever appears in the dashboard UI.
- `displayName` is always populated in the API response: the server defaults it to a friendly adjective-animal slug when the client omits it. It is free-form (spaces / mixed case allowed), capped at 100 chars, NOT required to be unique (one user, or two users, can have many workers sharing a displayName), and is renameable post-creation (see §4.1a / §5).
- Per-worker `id` uniqueness is guaranteed by UUID v4, so two workers (same or different owners) can share any displayName without collision.

### 6.6 Internal identity vs editable label (end to end)
- **Internal identity (`id`)** — server-minted UUID v4, immutable and stable across rebuild/unarchive. It is the WorkerStore key, the `agentor.id` label, the directory-mode storage leaf, and the basis for `containerName`. Worker volumes (`<containerName>-workspace`, `-agents`, `-docker`) and the directory-mode dirs (`workspaces/<id>/`, `agents/<id>/`) are keyed by this UUID. The Docker container id (`containerId`) is separate and changes on every rebuild. Clients never choose `id` — it is only displayed read-only as "Worker ID" in the settings modal.
- **Editable label (`displayName`)** — the only user-facing, mutable name. Set on create (typed or suggested) and changed at any time via `PATCH /api/containers/:id` (see §24.2). A rename touches ONLY `displayName`: the `id`, `containerName`, volumes, and port/domain mappings are unchanged, and the running container is not recreated. `displayName` is preserved across rebuild and archive/unarchive.

---

## 7. Environments Modal

### 7.1 List View
- "Environments" title + "New" button + "Close" button (dialog named "Environments"; full-screen sheet on phones)
- Per-environment row: name + "Built-in" badge (if applicable) + "View" (built-in) / "Edit" + "Delete" (custom)

### 7.2 Editor View (EnvironmentEditor)
- **Name** — text input (disabled in read-only/view mode)
- **Resource Limits** — CPU (number, step 0.5, "0 = unrestricted", decimal keypad on phones), Memory (text, "e.g. 4g, 512m"); side by side from 640px, stacked on phones
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
  - The mode cards show a focus ring when focused from the keyboard; the domain viewers expose `aria-expanded`
- **Git Providers** — "Select All" toggle + one checkbox per git provider (display name + host), all checked by default (= `enabledGitProviderIds: null`, which also covers providers configured later). Unchecking a provider keeps its credentials out of the environment's workers (see §27.3); unchecking Select All deselects every provider (`[]`, for running untrusted code); checking every provider again stores `null`. On save, ids of providers no longer configured are dropped
- **Expose APIs** — 3 checkboxes: Port Mappings, Domain Mappings, Usage Monitoring
- **Capabilities** — "Select All" toggle + per-capability checkbox with name and "Built-in" badge
- **Instructions** — "Select All" toggle + per-entry checkbox with name and "Built-in" badge
- **Environment Variables** — a read-only "Provided to the worker by the orchestrator" list (lock icon, name + description, from `GET /api/worker-env-vars`) + custom textarea (KEY=VALUE format). The read-only list shows ONLY the env vars a worker actually receives from the orchestrator (`ENVIRONMENT`, `CAPABILITIES`, `INSTRUCTIONS`, `WORKER`, `ORCHESTRATOR_URL`, `WORKER_CONTAINER_NAME`, `EXPOSE_PORT_MAPPINGS`, `EXPOSE_DOMAIN_MAPPINGS`, `EXPOSE_USAGE`). Orchestrator-wide settings (BETTER_AUTH_*, DASHBOARD_*, ACME_*, BASE_DOMAINS, LOG_*) are intentionally NOT shown here because they are never passed to workers.
- **Setup Script** — textarea (4 rows, monospace)
- **Actions** — "Create"/"Update" + "Cancel"/"Close" (sticky at the bottom on phones)
- Section legends are bold, high-contrast headings; icons are lucide

### 7.3 Validations
- Name cannot be empty
- Built-in environments: read-only (View mode, no edit/delete)

---

## 8. Capabilities Modal

### 8.1 List View
- "Capabilities" title + "New" button + "Close" button (dialog named "Capabilities"; full-screen sheet on phones — the same applies to the Instructions and Init Scripts modals)
- Per-capability row: name + "Built-in" badge + "View" (built-in) / "Edit" + "Delete" (custom)
- Empty state: "No capabilities yet. Create one to get started."

### 8.2 Editor View
- Name input (disabled in view mode)
- Content textarea (16 rows, monospace, YAML frontmatter + Markdown, disabled in view mode)
- "Create"/"Update" button (hidden in view mode) + "Cancel"/"Close" (sticky at the bottom on phones)
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
- "System Settings" title (names the dialog) + "Expand all" / "Collapse all" buttons
- Description: "Read-only view of all system configuration"
- Loading state: "Loading settings..."; a failed load shows the error (`role="alert"`) instead of an empty list
- Collapsible sections by category: Docker, Worker Defaults, Git Providers (`GITLAB_INSTANCES` + clone domains per provider; tokens are per-user), Domain Mapping, Network, Logging, Authentication, Init Scripts, App Types. (The legacy Agent Authentication section is removed — agent API keys and OAuth tokens are per-user and managed from the Account modal.)
- Logging section exposes `LOG_LEVEL`, `LOG_MAX_SIZE` (human-readable megabytes), `LOG_MAX_FILES`.
- Authentication section exposes better-auth settings: `BETTER_AUTH_SECRET` (status badge — value is never returned), `BETTER_AUTH_URL` (the public URL / OAuth issuer origin; shows the auto-derived value with `(auto)` when unset), `MCP_ENABLED` (the MCP server URL, or `disabled — <reason>`), `BETTER_AUTH_TRUSTED_ORIGINS` (list, or "none" fallback), `BETTER_AUTH_RP_ID` (shows the auto-derived `<subdomain>.<baseDomain>` value when unset and the dashboard domain is configured, the host of an https `BETTER_AUTH_URL` with `(auto)` when there is no dashboard domain, or "passkeys disabled" when none of these applies).
- Per-item: label + env var key (monospace) + value display
  - Status type: colored badge (configured=success)
  - Boolean type: badge (enabled/disabled)
  - List type: wrapped tags
  - String/Number type: monospace text (or em-dash for null)

### 11.2 Interactions
- Section headers expand/collapse (`aria-expanded`)
- "Expand all" / "Collapse all" buttons
- "Close" button (sticky at the bottom on phones)
- `/api/settings` is fetched each time the modal opens — never at dashboard load (non-admins would get a 403) and not when it closes
- On phones each setting stacks its label above its value

---

## 12. Port Mappings Panel

> Port mappings and domain mappings both run on the same **Traefik** container (`agentor-traefik`). There is no separate `agentor-mapper` container. Each port mapping becomes a dedicated TCP entrypoint on Traefik (`pm-<port>`) with a `HostSNI(*)` catch-all router that forwards to `containerName:internalPort`. Adding or removing a port mapping triggers a Traefik container recreate because entrypoints are part of Traefik's static config.

### 12.1 Empty State
- "No active mappings" message

### 12.2 Create Form (toggled by "+ Map" button)
- Type dropdown: "internal" / "external" (the stored values are `localhost` / `external`; named "Mapping type")
- Worker dropdown (only running containers, disabled placeholder "Worker"; named "Worker")
- External port input (placeholder "Ext port"; named "External port")
- Arrow indicator (→)
- Internal port input (placeholder "Int port"; named "Internal port")
- Port inputs bring up the numeric keyboard on phones (`inputmode="numeric"`, `enterkeyhint="done"`); all fields have visible borders and a focus ring
- "Add" button
- "Cancel" button (hides form)
- Form errors are announced (`role="alert"`)

### 12.3 Mapping List
- Mappings are **grouped by their owning worker**. Each group is a collapsible section: a header button (chevron + worker label + count badge) followed by the group's mapping rows. The worker label is resolved from the live container list / archived workers by id (`displayName`, fallback `shortName(m.workerId)`); the raw UUID is not printed. Groups default to **expanded**; clicking a header toggles its rows (collapse/expand) — the header stays visible while collapsed. Collapse state is per-group and component-local (resets on reload). Groups are sorted by worker label.
- Per-mapping row (indented under its group): type badge (blue "internal" / orange "external") + external port (monospace, `:<port>`) + arrow + internal port (monospace, `:<port>`) + remove (X) button (named "Remove mapping", larger on touch screens). The worker label is shown once in the group header, not repeated per row.
- Group headers expose `aria-expanded`
- Delete removes mapping immediately

---

## 13. Domain Mappings Panel

### 13.1 Conditional Visibility
- Only shown when domain mapper is enabled (BASE_DOMAINS env var configured)

### 13.2 Empty State
- "No active domain mappings" message

### 13.3 Create Form (toggled by "+ Map" button)
- Protocol toggle buttons: http, https, tcp (segmented group, `aria-pressed`)
  - https/tcp disabled when no TLS configured on selected base domains
  - TCP exclusive (deselects http/https); http and https can combine
- Worker dropdown (only running containers)
- Subdomain text input (optional — empty maps bare domain)
- Base domain toggle (multi-select when multiple; toggles individual domains on/off; `aria-pressed`)
- When multiple protocols and/or multiple base domains selected, creates cartesian product via batch API
- Path input (optional, hidden for TCP — e.g. /api; prefix stripped before forwarding)
- Internal port input
- Basic auth checkbox (hidden for TCP)
  - When enabled: username + password inputs (named "Username" / "Password"; the browser does not autofill the dashboard login into them)
- Wildcard subdomain checkbox
  - Enabled only when all selected base domains have challenge type `none`, `dns`, or `selfsigned` (disabled with tooltip for `http` HTTP-01 ACME)
  - When checked, shows live match preview `matches *.<sub>.<baseDomain>`
  - Auto-unchecks and reverts to false when the user selects a base domain that cannot issue wildcard certs
- "Cancel" and "Add" buttons
- Fields are named ("Worker", "Subdomain (optional)", "Path (optional)", "Internal port"), bordered with a focus ring; subdomain / path / username have autocapitalize / autocorrect / spellcheck off; the internal port shows a numeric keyboard
- The error message (`data-testid="domain-mapping-error"`) is announced (`role="alert"`)

### 13.4 Mapping List
- Mappings are **grouped by their owning worker**, identical to the Port Mappings panel (§12.3): a collapsible header (chevron + worker label + count badge) per worker, default expanded, click to toggle, sorted by worker label, collapse state component-local.
- Per-mapping row (indented under its group): protocol badge (blue=http, green=https, purple=tcp) + challenge type badge + optional indigo `wildcard` badge + full domain with path (if set) + lock icon (if basic auth; named "Basic auth enabled") + arrow + internal port (`:<port>`) + remove button ("Remove mapping"). The worker label is shown once in the group header, not repeated per row. Group headers expose `aria-expanded`.
- Wildcard mappings display the host with a `*.` prefix in the list
- Challenge type badges: none (gray), http (emerald), dns (cyan), selfsigned/self (amber)

### 13.5 Protocol Interactions
- Switching to TCP hides Basic auth and path input
- Switching back from TCP restores Basic auth and path input
- Checking Basic auth reveals username/password fields

### 13.6 Self-Signed CA Certificate
- "CA cert" download button shown when any base domain uses `selfsigned` challenge type
- Downloads PEM file (`agentor-ca.crt`) via `GET /api/domain-mapper/ca-cert` in place — no popup window or new tab (also works in the installed app)
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

> Per-user. The panel shows only the signed-in user's usage. `/api/usage` and `/api/usage/refresh` both require an authenticated session (return 401 otherwise) and are scoped to `requireAuth(event).user.id`. The orchestrator polls each user that has OAuth credentials independently. Workers fetch the same data via `/api/worker-self/usage` (no session needed — the user is identified via the calling worker's owner).

### 14.1 Content
- Loading state: "Loading..."; if the first load fails, a red `role="alert"` row "Couldn't load usage" (error text as its tooltip) with a **Retry** button replaces it — Retry loads the usage again. A failed poll after a successful one keeps the last data
- Per-agent row: name (Claude, Codex, Antigravity) + "Fetched Xm ago" timestamp + plan type badge + auth badge (OAuth=green, API key=blue, not configured=gray); badges are normal case (not uppercased), small text 10px
- Usage windows: progress bars per window (`role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`, named "<Agent> <Window> usage"; the fill animation honours reduced motion)
  - Label (Session, Weekly, Sonnet, etc.; Antigravity: one per model group, e.g. Gemini / Claude and GPT — full label on hover when truncated)
  - Color-coded: green (<50%), amber (50-79%), red (>=80%)
  - Percentage value (monospace)
  - Reset time (relative) with ISO tooltip
- Error display: red text
- Fallback: "No usage data for API key auth", "Not configured"

### 14.2 Interactions
- Refresh button (spinning icon while refreshing, disabled during refresh)
- Section collapse/expand
- Timestamps update every 30 seconds (paused while the page is hidden)

> There is no whole-host/system metrics card — host CPU/RAM/disk are inherently OS- and runtime-dependent, so only per-worker metrics are surfaced (see §4.1b), computed entirely through the Docker API.

---

## 15. Images / Update Notification Panel

### 15.1 Content
- Per-image row: image name (orchestrator, worker, traefik)
- Production mode indicators: digest values, update available (amber pulsing dot — no pulse with reduced motion — + old→new digest), error (the error detail on hover; apply errors are announced with `role="alert"`), current (green check), not found
- Per-image "Update" button (production mode, when update available)
- "Update All" button (production mode, when any updates available)
- "Re-check" / "Check for updates" button
- With `TRAEFIK_MODE=external` there is no Traefik row: the orchestrator neither runs nor updates Traefik
- "Prune dangling images" button with result display
- Private registries: the orchestrator authenticates its own pulls (worker image, orchestrator self-update, Traefik) and update checks with `REGISTRY_CREDENTIALS` (`host=user:password,...`) or a mounted docker `config.json` (inline `auths`); registries other than GHCR/Docker Hub get their token from the realm in their own `WWW-Authenticate` challenge (Bearer) or are queried with Basic auth. A fully qualified `ORCHESTRATOR_IMAGE` (`registry.example.com/me/agentor-orchestrator:tag`) is used without `WORKER_IMAGE_PREFIX`

### 15.2 Restarting State
- Blue overlay (`role="status"`) with spinner + "Reconnecting..." + description when orchestrator restarts. It stays up until the new server answers — after an observed outage, or after ~30s — and then the page reloads itself to load the new client build (installed apps need no manual reload)

---

## 16. Split Pane Layout

### 16.1 Pane Types
- Terminal (xterm.js)
- Desktop (noVNC iframe)
- Editor (code-server iframe)
- Apps (app instance management — includes VS Code Tunnel and SSH server as singleton app types)
- Logs (centralized log viewer)

Every pane type supports **multiple simultaneous instances**. Clicking the Terminal, Desktop, Editor, Apps, or Logs action button opens a brand-new tab each time — the same (container, type) pair can be opened any number of times and arranged side-by-side via the existing drag-to-split interactions. Each tab has its own unique id, independent xterm.js instance, iframe, or component state; backing services (tmux window attach, noVNC, code-server, app instance polling, log stream) already tolerate multiple concurrent clients so no additional reconciliation is required. Closing one tab does not affect sibling tabs of the same type.

### 16.2 Tab Bar (PaneGroupTabBar)
- Per-tab: type icon + "[Container] - [Type]" label (truncated at 140px, 180px from 640px wide; the full label as tooltip) + close button (visible on hover / focus, middle-click also closes)
- Active tab: highlighted background + accent bottom border
- ARIA tabs: the bar is a `tablist` named "Open panes"; each tab is a `tab` with `aria-selected`, its label as accessible name and a roving `tabindex` (only the active tab is in the tab order)
- Keyboard: ArrowLeft / ArrowRight / Home / End activate and focus a neighbouring tab, Enter / Space activate, Delete closes
- Close button: named "Close <label>" (e.g. "Close my-worker - Terminal"), tooltip "Close tab", not in the tab order. On touch screens only the active tab shows a larger (28px) close button; inactive tabs show none, so tapping one always activates it
- Draggable tabs (HTML5 DnD)
- Drop insert indicator (vertical blue line)
- While the sidebar is collapsed, the top-left tab bar leaves 40px on its left for the expand button (§2.2)

### 16.3 Pane Splitting
- Drag tab to edge (left/right/top/bottom, 25% threshold) to split
- Drag tab to center to merge into existing group
- 5-zone drop overlay with visual indicators (blue highlight + directional icons)
- Minimum split size: 15%
- Same-direction splits insert as siblings (no unnecessary nesting)

### 16.4 Pane Separator Resize
- 4px separator between panes (12px hit area, ±12px more on touch screens) with a 1px hairline dividing the panes
- Drag to resize adjacent panes — with mouse, touch or pen (Pointer Events with pointer capture); at most one resize per animation frame
- Accent-colour highlight on hover / focus / drag
- Cursor: col-resize (horizontal) or row-resize (vertical)
- Pointer events disabled on iframes/xterm during drag
- Keyboard: focusable `separator` named "Resize panes" (`aria-valuenow` = position in %); ArrowLeft / ArrowRight (side-by-side panes) or ArrowUp / ArrowDown (stacked panes) move it by 16px

### 16.5 Focus
- Top border in the theme accent colour on the focused pane group (when multiple panes exist)
- Pressing (mouse, touch or pen — `pointerdown`) on a pane focuses it
- New tabs open in focused group

### 16.5a Hidden tabs
- A tab is created on its first activation and then stays mounted while other tabs of its group are shown (sockets, iframes and scrollback survive); its polling pauses while it is hidden (§1.9)

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
- Font: Menlo / SF Mono / Cascadia Code / Fira Code / JetBrains Mono / Roboto Mono; size from the terminal preferences (default 14px, 12px on phones; 8–28px)
- Auto-resize on container element resize (ResizeObserver), incl. the soft keyboard opening (the app shell follows the visual viewport)
- Theme-reactive (dark/light mode switching)
- Clickable URLs in the output (web-links addon)
- Automatic reconnect: a dropped connection shows a "Disconnected — reconnecting…" pill (`data-testid="terminal-disconnected"`) with **Reconnect now**; reconnects with backoff while the page is visible, when the network comes back, and when the page becomes visible again (also after >30s in the background)

### 17.1a Selection & clipboard
- Click-drag selects text locally — always (clicks/drags are never forwarded to tmux, no modifier key needed)
- **The selection survives mouse movement**, also while an application (through tmux) requests any-motion mouse tracking (`CSI ?1003h`): xterm.js is never put into mouse-reporting mode; the requested modes are recorded and only the wheel is reported to the application
- Mouse wheel: reported to tmux when it tracks the mouse (first wheel-up enters copy-mode, further ticks scroll the scrollback); Ctrl+wheel stays browser zoom; without mouse tracking the local scrollback scrolls
- Copy: Cmd+C (macOS); Ctrl+Shift+C / Ctrl+Insert, or Ctrl+C while text is selected (selection then cleared, so the next Ctrl+C interrupts) elsewhere; Ctrl+C without a selection still sends the interrupt
- Paste: Cmd+V (macOS); Ctrl+Shift+V / Shift+Insert elsewhere (native paste event → bracketed paste when the app enabled it)
- Right-click context menu (not on touch devices): Copy (disabled without a selection), Paste, Select all, Open text view, Compose text, Larger / Smaller font, Reset font size, Show/Hide touch keys
- Copy works on plain-http LAN origins too (legacy `execCommand('copy')` fallback); when clipboard reading is unavailable or denied, Paste opens the composer with a hint to long-press → Paste

### 17.1b Touch & mobile input
- Touch key toolbar (`data-testid="terminal-toolbar"`, `role="toolbar"`) below the terminal — shown automatically on touch (coarse-pointer) devices, toggled on any device from the keyboard button at the right of the tmux tab bar (`aria-label` "Show touch keys" / "Hide touch keys", `aria-pressed`); persisted (`terminal.toolbar`: auto / show / hide)
  - Show/Hide keyboard (focus/blur the terminal), Esc, Tab, **Ctrl** and **Alt** latches (`data-key="ctrl"` / `"alt"`, `aria-pressed`; apply to the next toolbar key or the next character typed on the keyboard, then release), arrows (`data-key="up"` …; hold to repeat; application-cursor aware), ⇧↵ (newline in agents), ^C, Home, End, PgUp, PgDn (repeat), `/ - | ~ _`, smaller / larger font
  - Fixed actions: **Compose text**, **Paste**, **Select text**
  - Toolbar buttons never take focus, so tapping a key does not close the soft keyboard
- Composer (`data-testid="terminal-composer"`): native multi-line text field (autocorrect, dictation, swipe typing, long-press paste; 16px so iOS does not zoom) with **Send** (paste + Enter), **Insert without Enter**, **Close composer**; Ctrl/Cmd+Enter sends, Escape closes
- Text view (`data-testid="terminal-text-view"`): the window's text with 3000 lines of scrollback as natively selectable text (OS selection handles / copy menu), Copy (selection or everything), Reload, Close (Escape); falls back to the visible screen when the capture fails
- Touch gestures on the terminal: swipe to scroll (with momentum; scrollback through tmux), long-press to select the word under the finger and drag to extend → floating **Copy / Select all / More… / ×** actions (`data-testid="terminal-selection-actions"`), two-finger pinch to change the font size, tap to focus (opens the soft keyboard) or open a link
- No iOS zoom-on-focus (16px terminal inputs), no pull-to-refresh / overscroll bounce

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
- New tab creation: text input for name (`aria-label` "New terminal tab name") + "+" button (`aria-label` "New terminal tab")
  - Empty input uses auto-generated placeholder (shell-xxxx)
  - Name collisions generate random name
- Close buttons are labelled (`Close terminal <name>`)
- Right edge: pane actions (touch keys toggle)
- Larger targets on touch devices (38px bar, 32px tabs, 16px inputs)
- Polls for external changes every 3 seconds

---

## 18. Service Panes (Desktop & Editor)

### 18.1 Desktop (noVNC)
- Starting state: large icon + spinner + "Desktop is starting..." text on the terminal background
- Running state: a 30px header in the terminal bar colours with a green pulsing dot (no pulse with reduced motion) + "Desktop running" + an "Open in tab" button (external-link icon) over the full iframe
- The iframe is titled "Desktop for this worker" and may go fullscreen (`allow` includes `fullscreen`, plus `allowfullscreen`)
- "Open in tab" is hidden in an iOS home-screen app (the new tab would open in Safari, signed out)
- Service status polled every 5 seconds while the tab is shown; a single failed status check no longer reloads the iframe — it is torn down only after 3 failures in a row or when the server reports the service stopped

### 18.2 Editor (code-server)
- Same pattern as Desktop
- "Editor is starting..." → "Editor running" + iframe (titled "Editor for this worker")
- "Open in tab" opens in new browser tab
- Clipboard permissions (`clipboard-read; clipboard-write`) and fullscreen enabled on iframe

---

## 19. Apps Pane

### 19.1 Content
- "Apps" heading; the pane uses the terminal theme surfaces (terminal background, bar-coloured cards) and less padding on phones
- Empty state: "No app types available"
- Per app type: name, description, and either:
  - **Multi-instance** (chromium, socks5): "+ New Instance" button (soft style; always shown, up to `maxInstances`).
  - **Singleton** (vscode, ssh): "Start" button (soft style, play icon) shown only when no instance is running; hidden once one exists (Stop lives on the row).
- A failed start (other than 409 "already running") shows the error toast "Could not start app"
- Status dots are named by their status (`role="img"`); Stop buttons are larger on touch screens
- Empty-state label per app type: "No running instances" (multi-instance) or "Not running" (singleton).
- Per instance (chromium/socks5): status dot (green/gray), instance ID (monospace), port label with tooltip, "Stop" button.
- Per instance (vscode — `VsCodeAppRow`): status dot (green=running, amber=auth_required), instance ID `vscode`, status label (`Stopped` / `Waiting for GitHub authentication` / `Connected as <machineName>`), "Stop" button. In `auth_required` the row also shows the clickable `https://github.com/login/device` URL plus the monospace device code with a copy button ("Copy code <code>"). The status label truncates (full text on hover). In `running` the row shows an instruction to install **Remote - Tunnels** in a local VS Code and connect to the machine name.
- Per instance (ssh — `SshAppRow`): status dot, instance ID `ssh`, port label `:22 → host :<externalPort>`, "Stop" button. When running with a public key configured the row shows the SSH command `ssh agent@<host> -p <externalPort>` (selected entirely on tap) with a copy-to-clipboard button ("Copy SSH command"). When the user's `sshPublicKey` is empty the row shows an amber warning pointing to **Account → SSH Access**.

- Copy buttons work on plain-http LAN origins too (clipboard fallback): the icon turns into a check mark for 1.5s, or the toast "Copy failed — select the text and copy it manually" appears

### 19.2 App Types
- **Chromium** — CDP, ports 9222–9322, `maxInstances: 10`
- **SOCKS5 proxy** — microsocks, ports 1080–1180, `maxInstances: 10`
- **VS Code Tunnel** — singleton (`maxInstances: 1`), no container port, launches `code tunnel --accept-server-license-terms --name <userId-prefixed-name>`. Auth persists per worker in the agent-data volume (`~/.vscode` symlinked to `.agent-data/.vscode`) — survives restarts, rebuilds, archive/unarchive.
- **SSH Server** — singleton, OpenSSH on fixed internal port `22`, `PubkeyAuthentication yes` + `PasswordAuthentication no` + `StrictModes no`. Only the `agent` user is allowed. `authorized_keys` is bind-mounted read-only from `<DATA_DIR>/users/<userId>/ssh/authorized_keys` (the per-user key saved in **Account → SSH Access**).

### 19.3 SSH auto port mapping
- Starting the SSH app creates a port mapping `type: external`, `internalPort: 22`, `externalPort` chosen from the unused ports in `[22000, 22999]`, stamped with `appType: 'ssh'`, `instanceId: 'ssh'`.
- The chosen external port is applied with a strict Traefik reconcile; if it turns out to be occupied on the host (Traefik can't bind it), that candidate is dropped from the store and the **next free port is tried** (bounded retry), so the SSH app never persists an unbindable mapping.
- If a mapping already exists for the same `(containerName, appType='ssh', instanceId='ssh')` it is reused — external port stays stable across stop/start, restart, archive/unarchive, and rebuild.
- Stopping the SSH app does **not** remove the port mapping. Only permanent worker deletion does (via `cleanupWorkerMappings`).
- Users can also delete the mapping manually from the Port Mappings panel.

---

## 20. Workspace Upload/Download

### 20.1 Upload Modal
- Opens from upload icon button on container card
- Title "Upload to Workspace" (names the dialog) + target path description; full-screen sheet with a sticky Upload / Cancel row on phones
- FileDropZone: drag files/folders, click / tap to pick files (plain multi-file picker — works on phones), a separate "Choose a folder" button for folders, file list with remove/clear (§22)
- Upload errors are announced (`role="alert"`)
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
- Both buttons carry those names as `aria-label` and get larger touch targets; the date text has higher contrast

### 21.3 Interactions
- Unarchive: recreates container from stored metadata, preserves workspace
- Delete: permanently removes workspace + DinD volumes (with confirm dialog)

---

## 22. File Drop Zone

### 22.1 Drop Zone
- Dashed-border area with cloud-upload icon
- "Drop files or folders here" + "or click to choose files" ("Tap to choose files" on touch devices)
- Clicking / tapping the zone opens a plain multi-file picker (exactly one non-`webkitdirectory` file input)
- A "Choose a folder" button below the zone opens the folder picker — only rendered where the browser supports `webkitdirectory`
- Keyboard-operable: the zone is a `button` named "Choose files to upload" (Enter / Space, focus ring)
- Blue highlight on dragover
- Recursive folder processing via FileSystemEntry API (dropped folders)

### 22.2 File List
- Count + total size summary
- "Clear all" link
- Scrollable list (max 128px): filename + remove button (named "Remove <file>"; visible on hover, on keyboard focus and always on touch screens)

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
- Active filter button shows accent border color; `aria-pressed="true"` marks the explicitly selected filters
- Search input with 300ms debounce — filters entries by message substring (named "Search logs"; no autocorrect / autocapitalize / spellcheck)
- Icon buttons are named "Auto-scroll to bottom" (`aria-pressed`) and "Clear all logs"
- Filter buttons are at least 32px tall on touch screens; at pane widths of 640px or less the search field takes a full line

### 23.3 Log Entries
- Each entry shows: timestamp (HH:MM:SS.mmm) + level badge + source badge + source ID (for container logs) + message
- Long messages wrap (no ellipsis, no horizontal overflow); at pane widths of 640px or less each row wraps with the message on its own line and the source ID capped at 40%
- Level badges color-coded: debug (gray), info (blue), warn (amber), error (red)
- Source badges color-coded: orchestrator (purple), worker (green), traefik (orange)
- Badge and row colours have light-theme and dark-theme variants (readable in both modes)
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
- Status bar: green/red connection dot + "Connected"/"Disconnected" text (`role="status"`) + entry count

### 23.7 Live Streaming
- WebSocket connection to `/ws/logs` for real-time log entries; bursts are rendered once per animation frame
- Auto-reconnect on disconnect (3s delay)
- The socket is open only while at least one Logs pane is mounted — closing the last Logs tab disconnects it (entries are kept) — and closes after the page has been hidden for 60s; showing the page again refetches history and reconnects
- History loaded from REST API on mount (500 most recent entries); all open Logs tabs share one filtered list and one history fetch per filter change
- Client-side soft cap of 50,000 entries — older entries are evicted only while the user is at the bottom (auto-scroll on); when scrolled into history, eviction is paused so the viewport never collapses under the user. Evicted entries are recoverable via scroll-up since they are still on disk.

---

## 24. API Endpoints (Server-Side Features)

### 24.1 Health
- `GET /api/health` — returns `{ status: 'ok', containers: N }`

### 24.2 Containers
- Every `ContainerInfo` carries the standard base-resource fields: `id` (immutable worker UUID v4), `createdAt`, `updatedAt`, plus `userId` (owner). Identity fields: `id` is the stable worker identity; `containerId` is the Docker container id (changes on every rebuild/unarchive); `containerName = agentor-worker-<id>`; `imageName` (+ `imageId`); `.displayName` is the editable label and is always populated. There is NO `name` field.
- On orchestrator startup, running workers are synced only after the worker store has loaded, so each keeps its owner (`userId`) from the first request on — worker-self calls right after a restart (e.g. an agent creating a domain mapping) are attributed to the right user.
- **Normalized — references, not copies.** `ContainerInfo`/`WorkerRecord` store ONLY the worker's own settings (`displayName`, `repos`, `mounts`, `initScript`) plus foreign keys: `userId` (owner) and `environmentId` (assigned environment). They do NOT carry the environment's config (`environmentName`, `cpuLimit`, `memoryLimit`, `networkMode`, `dockerEnabled`, `allowedDomains`, `includePackageManagerDomains`, `setupScript`, `envVars`, `exposeApis`, `capabilityNames`, `instructionNames`) nor the git identity (`gitName`, `gitEmail`) — those are resolved live from the `EnvironmentStore` / the owning user at build time. The create/list/PATCH/rebuild/unarchive responses for a worker therefore expose none of those fields (they are `undefined`). Resource limits (`cpuLimit`/`memoryLimit`) are an environment property — `POST /api/containers` no longer accepts them, and there is no per-worker override.
- **Persisted record vs runtime view.** The *persisted* `WorkerRecord` (workers.json) additionally omits everything the Docker API can re-discover: `containerId`, `containerName`, `imageName`, and `imageId` are NOT stored on disk. They are resolved at runtime in `ContainerManager.sync()` by matching the `agentor.id` label (and the container name is just recomputed as `agentor-worker-<id>`), then merged onto the *runtime* `ContainerInfo` that the API returns. So `GET /api/containers` items carry those four fields, but a `GET /api/archived` item (the raw stored record) does not.
- `GET /api/containers` — list all workers. Each `ContainerInfo.id` is the immutable worker UUID; `.containerId` is the current Docker container id; `.imageName` is the image reference; `.displayName` is always populated.
- `POST /api/containers` — create worker. Body NO LONGER accepts `id` (or `name`). Accepts optional `displayName` (string, trimmed, ≤100 chars else HTTP 400) plus environmentId, initScript, repos, mounts. The orchestrator mints the UUID `id` itself; the response `ContainerInfo.id` is that UUID, `.containerId`/`.containerName`/`.imageName` are populated, and `.displayName` is always populated (defaults to an adjective-animal slug when omitted). **Host bind-mount `source`/`target` are validated** (on both create and PATCH): a value containing `:` (Docker mount-option injection), the Docker socket (`/var/run/docker.sock`), or the orchestrator data dir is rejected with 400. **Repos are validated** (on both create and PATCH): an array of `{ provider?, url?, branch? }` strings; a missing `provider` defaults to `github`; an unknown provider id → 400 `Unknown git provider "<id>" (available: …)`.
- `PATCH /api/containers/:id` — update editable worker settings WITHOUT recreating the container (`:id` is the worker UUID). Body is a partial `{ displayName?, environmentId?, initScript?, repos?, mounts? }` — only the present keys change. Returns the updated `ContainerInfo`. The internal identity (`id`, `containerName`, volumes, mappings) is always unchanged; `updatedAt` is bumped.
  - **`displayName` applies immediately (no rebuild needed)** — applied to the running worker immediately. Backward compatible with the old rename: `PATCH { displayName }` works exactly as before.
  - **`environmentId`, `initScript`, `repos`, `mounts` are rebuild-requiring** — the new value is stored (for `environmentId`, only the FK is stored, after validating it exists in the EnvironmentStore) and the worker is flagged `pendingRebuild: true` in the response and the container list. The running container is NOT changed until the next `POST /api/containers/:id/rebuild`, which re-resolves the environment config + git identity live from the stored FKs and clears the flag.
  - Validation: empty/whitespace-only `displayName` → 400; `displayName` >100 chars → 400; non-existent `environmentId` → 400; malformed `repos`/`mounts` → 400; unknown worker id → 404; a regular user editing another user's worker → 403 (ownership via `requireContainerAccess`).
  - `ContainerInfo.pendingRebuild` is `true` while rebuild-requiring edits are unapplied; a restart does NOT clear it (a restart reuses the baked env), only create/rebuild/unarchive do.
- `GET /api/containers/generate-name` — returns `{ displayName: "<friendly slug>" }`, a display-name SUGGESTION (the field is `displayName`, not `name`). The slug matches `/^[a-z]+-[a-z]+$/` (adjective-animal), with a rare fallback of `worker-<6 lowercase alnum>`.
- `POST /api/containers/:id/stop` — stop worker
- `POST /api/containers/:id/restart` — restart worker
- `DELETE /api/containers/:id` — remove worker (cleans up port/domain mappings, volumes, store)
- `POST /api/containers/:id/rebuild` — rebuild worker (destroys and recreates with latest image, preserves workspace, agents, and DinD volumes plus metadata including host bind **mounts** — equivalent to archive + unarchive). Applies any `pendingRebuild` settings edits (environment, repos, mounts, init script) and clears the flag.
- `POST /api/containers/:id/archive` — archive (port/domain mappings are preserved and reattach to the new container on unarchive via the stable `containerName`)
- Port and domain mappings survive stop/restart, archive/unarchive, and rebuild — they are keyed by the globally unique `containerName` which is stable across the worker's whole lifecycle. Traefik routes to the container by DNS name, so lookups pick up the new container after rebuild/unarchive without any mapping changes. Mappings are only removed on permanent delete (`DELETE /api/containers/:id` or `DELETE /api/archived/:id`).
- `GET /api/containers/:id/logs` — logs with optional ?tail=N (default 200, max 10000)
- `GET /api/containers/:id/workspace` — download workspace .tar.gz; optional `?path=` downloads a file or sub-directory (relative to, or absolute inside, `/workspace`; filename `<displayName>-<basename>.tar.gz`). Paths escaping `/workspace` → 400, missing paths → 404. An abandoned download (client disconnects) ends Docker's archive stream, so the worker is not left locked
- `POST /api/containers/:id/workspace` — upload files: multipart (each part's filename is its path under `/workspace`) or JSON `{ files: [{ path, content, encoding: 'utf8' | 'base64' }] }` (used by MCP). Paths are relative to, or absolute inside, `/workspace`; parent directories are created, files are owned by `agent`; `..` segments or paths outside the workspace → 400
- `POST /api/containers/:id/exec` — run a bash command as the `agent` user (agent CLIs on PATH): body `{ command, cwd?, timeoutSeconds? }` (default cwd `/workspace`, timeout 60 s, max 600 s) → `{ exitCode, stdout, stderr, truncated, timedOut, durationMs }`; stdout/stderr capped at 1 MiB each. 400 on invalid body, 404 unknown worker, 403 other user's worker, 409 when not running
- `GET /api/containers/:id/desktop/screenshot` — PNG (`image/png`, 1920x1080) of the worker's virtual display (maim). 409 when not running
- `POST /api/containers/:id/desktop/input` — one mouse / keyboard action on the virtual display (xdotool): `{ action, x?, y?, toX?, toY?, text?, keys?, direction?, amount? }` with actions `click` / `double_click` / `right_click` / `middle_click` (at x,y or the current pointer), `move`, `drag` (x,y → toX,toY), `scroll` (direction up/down/left/right, amount 1–50, default 3), `type` (text), `key` (xdotool key names, e.g. `ctrl+l Return`). Field validation → 400
- `GET /api/containers/:id/metrics` — single worker's live resource metrics (zeroed snapshot when not running / not yet sampled). Ownership-checked (`requireContainerAccess`): 401 unauth, 403 cross-user, 404 unknown id.
- `GET /api/containers/:id/export` — stream a worker export bundle (`.tar`). `?includeRootfs=` (default `true`) toggles the `docker export` filesystem snapshot. 401/403/404 as above; the worker must be running or stopped. See §28.
- `POST /api/containers/import` — restore a worker from an export bundle (raw `.tar` request body, `Content-Type: application/x-tar`). `?displayName=` overrides the restored label. Returns 201 + the new `ContainerInfo` (fresh UUID id). 400 on an invalid bundle, 401 unauth. See §28.
- `GET /api/containers/:id/desktop/status` — desktop service status
- `GET /api/containers/:id/editor/status` — editor service status
- VS Code tunnel and SSH are managed through the generic apps endpoints below (`appType='vscode'` / `appType='ssh'`); no dedicated routes exist for them.

### 24.3 Tmux Panes
- `GET /api/containers/:id/panes` — list tmux windows
- `POST /api/containers/:id/panes` — create window (optional name, auto-generated "shell-xxxx")
- `PUT /api/containers/:id/panes/:windowIndex` — rename window (name validation: alphanumeric/underscore/hyphen)
- `DELETE /api/containers/:id/panes/:windowIndex` — kill window (window 0 protected: 403)
- `POST /api/containers/:id/panes/:windowIndex/keys` — type into a window like a user at the keyboard: `{ keys?: string[], text?: string, enter?: boolean }` applied in order keys (tmux key names, e.g. `C-c`, `Up`) → literal text → Enter (short pause before Enter so TUIs don't treat it as part of a paste). Unknown window → 404; invalid body → 400
- `GET /api/containers/:id/panes/:windowIndex/capture?history=N` — the window's visible screen as plain text (`{ content }`), plus N lines of scrollback (0–10000). Unknown window → 404

### 24.4 Apps
- `GET /api/containers/:id/apps` — list all app instances. Each entry carries `{ id, appType, port, status }` plus optional `externalPort` (ssh) / `machineName` (vscode) / `authUrl` (vscode) / `authCode` (vscode). `status` is `'running' | 'stopped' | 'auth_required'`.
- `GET /api/containers/:id/apps/:appType` — list by type
- `POST /api/containers/:id/apps/:appType` — start instance. Returns `{ id, port, externalPort? }`. Returns HTTP **409** when starting a singleton (`vscode` / `ssh`) that already has a running instance. For `vscode` the orchestrator passes the per-user tunnel name as an extra arg to `manage.sh start`; for `ssh` the orchestrator allocates an external port in `22000–22999` (reusing any existing mapping for `(containerName, appType='ssh', instanceId='ssh')`), writes it to the port-mapping store with `appType: 'ssh'`, `instanceId: 'ssh'`, and triggers a Traefik reconcile.
- `DELETE /api/containers/:id/apps/:appType/:instanceId` — stop instance. Idempotent. Does **not** remove any auto-created port mapping (that only goes away on permanent worker delete or via an explicit `DELETE /api/port-mappings/:port`).
- `GET /api/app-types` — list app type definitions. Each entry includes `{ id, displayName, description, ports, maxInstances, singleton }` plus optional `fixedInternalPort` and `autoPortMapping: { type, externalPortStart, externalPortEnd }` for apps that declare them (ssh).

### 24.5 Port Mappings
- Every `PortMapping` carries the standard base-resource fields: `id` (UUID), `userId`, `createdAt`, `updatedAt` — plus `workerId`, `containerName`, `externalPort`, `internalPort`, `type`.
- `GET /api/port-mappings` — list all
- `POST /api/port-mappings` — create (externalPort, internalPort, type, workerId). `workerId` resolves against either the globally unique Docker `containerName` (worker-API shortcut via `$WORKER_CONTAINER_NAME`) or the worker's UUID `id`. Response `workerId` equals the owning worker's UUID (`container.id`) and `containerName` equals `container.containerName`.
- `DELETE /api/port-mappings/:port` — remove
- `GET /api/port-mapper/status` — counts by type
- Validations: port range 1-65535, type localhost/external, worker must exist and be running, duplicate port 409
- **Misconfig safety (no Traefik wedge)**: external **80/443 are rejected with 409** when domain routing/the dashboard is active (reserved for Traefik's web entrypoints). The mapping is applied with a **strict, transactional** Traefik reconcile — if the host port can't be bound (occupied by another container/process), Traefik rolls back to its last-good config (the dashboard is never left unreachable) and the just-persisted mapping is **rolled back out of the store**, returning 409. The same reserved-port + transactional-rollback path guards the worker-self port-mapping route and the SSH auto-port-mapping allocator (which retries the next free port on conflict). See `docs/networking.md` → **Reconcile Robustness**.
- **External mode (`TRAEFIK_MODE=external`)**: for running behind a reverse proxy the orchestrator does not manage. Every apply only (re)writes `<DATA_DIR>/traefik-config.yml` — the same file-provider config managed mode feeds its own Traefik — for that proxy to consume; no Traefik container is ever started, there is no host-port pre-flight (the ports belong to the external proxy), and a leftover managed-mode `agentor-traefik` is removed. The Images panel and update checker leave Traefik out (`traefik: null`). The default, `managed`, keeps the bundled Traefik.

### 24.6 Domain Mappings
- Every `DomainMapping` carries the standard base-resource fields: `id` (UUID), `userId`, `createdAt`, `updatedAt` — plus `workerId`, `containerName`, and the routing fields.
- `GET /api/domain-mappings` — list all
- `POST /api/domain-mappings` — create (subdomain, baseDomain, path, protocol, wildcard, workerId, internalPort, basicAuth). `workerId` resolves against either the `containerName` or the worker's UUID `id`. Response `workerId` equals the owning worker's UUID (`container.id`) and `containerName` equals `container.containerName`.
- `POST /api/domain-mappings/batch` — batch create (single Traefik reconcile). Accepts `wildcard` per item.
- `DELETE /api/domain-mappings/:id` — remove (idempotent)
- `GET /api/domain-mapper/status` — enabled flag, baseDomains list, baseDomainConfigs (domain + challengeType + optional dnsProvider), hasSelfSignedCa flag, dashboard URL
- `GET /api/domain-mapper/ca-cert` — download self-signed CA certificate PEM (404 when no selfsigned domains)
- Validations: protocol http/https/tcp, HTTPS/TCP require TLS, subdomain format, path format (must start with /), path not allowed for TCP, port range, duplicate 409 (subdomain+baseDomain+path+protocol), protocol conflict 409, wildcard rejected 400 when base domain uses HTTP-01 ACME (`challengeType === 'http'`)
- **Misconfig safety**: domain mappings apply with a **strict, transactional** Traefik reconcile (single + batch, dashboard + worker-self). The first domain mapping/dashboard binds host 80/443; if those can't be bound, Traefik rolls back to its last-good config and the just-persisted mapping(s) are **rolled back out of the store**, returning 409 — so a bad mapping never wedges Traefik or takes the dashboard down. See `docs/networking.md` → **Reconcile Robustness**.

### 24.7 Environments
- `GET /api/environments` — list all
- `POST /api/environments` — create
- `GET /api/environments/:id` — get single
- `PUT /api/environments/:id` — update
- `DELETE /api/environments/:id` — delete
- Built-in "default" environment: cannot edit/delete
- `enabledGitProviderIds` (`null` = every provider incl. ones configured later — the default, also on the built-in default and on environments saved before the field existed; `[]` = none; or a list of provider ids, deduplicated): settable on create and update, left untouched by updates that omit it; anything but null / an array of strings → 400; an unknown provider id → 400 `Unknown git provider "<id>" (available: …)`

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
- Built-in scripts: claude, codex, antigravity (`agy --dangerously-skip-permissions`)

### 24.11 Archived Workers
- `GET /api/archived` — list. Each entry is the raw persisted `WorkerRecord`: `id` is the worker UUID (the WorkerStore key), `displayName` is the editable label, `status` is `archived`, plus `createdAt`/`updatedAt`/`archivedAt` and the config (`environmentId`, `repos`, `mounts`, `initScript`). It deliberately does NOT include the Docker-derived `containerId`/`containerName`/`imageName`/`imageId` (those exist only on the live `ContainerInfo`, discovered at runtime).
- `POST /api/archived/:id/unarchive` — restore. The `:id` segment is the worker UUID. Returns a `ContainerInfo` whose `.id` is that same UUID (stable across unarchive); `displayName` is preserved while `containerId` is the freshly created container's id. The worker is resolved globally by `id` (via `WorkerStore.findById`) and ownership-checked: an **admin may unarchive any user's** archived worker, a regular user only their own (else 403). There is no `?userId=` query (the legacy `[name]` route folder + admin query were removed).
- `DELETE /api/archived/:id` — permanently delete (`:id` is the worker UUID). Same global-resolve + admin-or-owner ownership check as unarchive.

### 24.12 Updates
- `GET /api/updates` — status for 4 images
- `POST /api/updates/check` — trigger manual check
- `POST /api/updates/apply` — pull + recreate (optional { images } body for per-image)
- `POST /api/updates/prune` — prune dangling images

### 24.13 Usage
- `GET /api/usage` — agent usage status (per-agent auth type, windows, timestamps)
- `POST /api/usage/refresh` — trigger immediate refresh

### 24.13a Resource Metrics (per-worker, via the Docker API)
- There are NO system/host metrics endpoints — host metrics are OS/runtime-dependent and were removed deliberately. Only per-worker metrics exist, all sourced from the Docker API.
- `GET /api/worker-metrics` — `{ workers: WorkerMetrics[] }` for every running worker the caller owns (admins see all). A worker appears after the next ~3s sample tick. Auth-gated (401 unauth).
- `POST /api/worker-metrics/refresh` — force an immediate re-sample (cpu/mem/net + disk) and return the same shape. Auth-gated.
- `GET /api/containers/:id/metrics` — a single worker's `WorkerMetrics` (see §24.2). `WorkerMetrics` = `{ workerId, containerName, displayName, status, cpuUtilization (0-100 of host, from docker stats), memoryUsedBytes, memoryLimitBytes, memoryUtilization, diskUsedBytes (writable layer SizeRw + du of /workspace + agent data; 60s cadence), netRx/TxBytesPerSec, blkRead/WriteBytesPerSec, lastChecked, error? }`.

### 24.14 Git providers (GitHub, gitlab.com, self-managed GitLab)
- Providers: `github` and `gitlab` (gitlab.com) are built in; `GITLAB_INSTANCES=<name>=<url>,…` adds `gitlab-<name>` per self-managed server (URL may carry a relative URL root; malformed, duplicate or gitlab.com entries are skipped with a warning). Every route below takes the provider id and uses the **caller's** token from their env vars (`tokenEnvVar`). Unknown provider → 404 on every route; unauthenticated → 401.
- `GET /api/git-providers/:providerId/repos` — `{ repos: [{ fullName, private, defaultBranch }], tokenConfigured, username, namespaces, error? }`. `namespaces` = GitHub orgs / GitLab groups (Developer+) the user can create repos in. No token → `tokenConfigured:false`, empty lists. A configured-but-failing token (bad/missing scopes/rate-limited/unreachable) → `tokenConfigured:true` **with** an `error` string (e.g. `GitLab (acme) API error (401): 401 Unauthorized`). GitLab: projects are listed with keyset pagination (offset pages time out on large self-managed instances), and every page is requested on the configured URL — only the query of a `Link` header (which self-managed instances may point at their external URL) or `X-Next-Page` is used; `internal` projects count as private, repos sorted by `fullName`.
- `POST /api/git-providers/:providerId/repos` — create an empty repo `{ owner, name, private? }` → `{ repo }`. `owner` is the user's login or a namespace (GitLab group path such as `group/sub`). No token → 400; missing/blank owner or name → 400; provider validation errors (e.g. name taken) → 400 with the provider's message; unknown namespace → 404.
- `GET /api/git-providers/:providerId/branches?repo=<fullName>` — `{ branches: [{ name }], defaultBranch }` (`.git` suffix tolerated). No token / missing `repo` / malformed path (GitHub needs `owner/repo`, GitLab ≥ 2 segments) → 400; unknown repo → 404.
- Upstream errors: provider 401 or 5xx/unreachable → 502 (a rejected provider token is never reported as the caller's own 401), no response within 30s → 504 `<provider> did not respond within 30s`, 422 → 400, other statuses pass through. Responses are cached 60s per provider + token; a create invalidates the repo list.

### 24.15 Configuration
- `GET /api/settings` — orchestrator-wide settings (Docker, Worker Defaults, Git Providers (`GITLAB_INSTANCES` — `name=url` list or `none` — and `<providerId>.cloneDomains` per provider, never tokens), Domain Mapping, Network, Logging, Authentication, Init Scripts, App Types). The old `agent-auth` section is removed — agent API keys live per user under `/api/account/env-vars`.
- `GET /api/worker-env-vars` — the system env vars the orchestrator injects into every worker (the complete set a worker actually receives): `ENVIRONMENT`, `CAPABILITIES`, `INSTRUCTIONS`, `WORKER` (structured JSON payloads), `ORCHESTRATOR_URL`, `WORKER_CONTAINER_NAME`, and the `EXPOSE_PORT_MAPPINGS` / `EXPOSE_DOMAIN_MAPPINGS` / `EXPOSE_USAGE` flags. Each entry is `{ name, description }`. Intentionally does NOT include orchestrator-wide settings (BETTER_AUTH_*, DASHBOARD_*, ACME_*, BASE_DOMAINS, LOG_*) — those are never passed to workers and are admin-only via `/api/settings` — nor per-user secrets (`GITHUB_TOKEN`, `*_API_KEY`), which live under `/api/account/env-vars`. (Replaces the former `/api/orchestrator-env-vars`, which mislabeled orchestrator config as worker env and leaked config-status to non-admins.)
- `GET /api/git-providers` — provider list `[{ id, type ('github' | 'gitlab'), displayName, url, placeholder, tokenEnvVar, tokenConfigured }]` (GitHub, GitLab, then `GitLab (<name>)` per `GITLAB_INSTANCES` entry with `tokenEnvVar` `GITLAB_<NAME>_TOKEN`); `tokenConfigured` is the **current user's** status from their `UserEnvVars`
- `GET /api/agent-api-domains` — firewall allowlist
- `GET /api/package-manager-domains` — PM domain list

### 24.15a Per-user Account env vars and credentials
- `GET /api/account/me` — the current user `{ id, name, email, role, emailVerified, banned, createdAt, updatedAt }`
- `PATCH /api/account/profile` — update the current user's `name` and/or `email` (validated; taken email → 409; `role` is ignored)
- `GET /api/account/oauth-apps` — OAuth applications (MCP clients) the current user authorized: `[{ clientId, name, uri?, scopes, authorizedAt }]`
- `DELETE /api/account/oauth-apps/:clientId` — revoke one (consent + refresh / access tokens deleted; the MCP endpoint rejects the client immediately); 404 when not authorized
- `GET /api/account/env-vars` — returns the current user's `UserEnvVars` `{ userId, createdAt, updatedAt, envVars: [{ key, value }] }` — a single uniform list keyed by the env var NAME, no hardcoded fields. Owner-only — admins do NOT see other users' values via this endpoint.
- `PUT /api/account/env-vars` — REPLACES the current user's `envVars` list with the supplied `{ envVars: [...] }`. There is no per-field/partial-update semantics anymore — the whole list is the unit of update. Every key must match `[A-Z_][A-Z0-9_]*`, must not collide with reserved names (`ENVIRONMENT`, `WORKER`, `ORCHESTRATOR_URL`, etc.), and must be unique. Validation failures return 400.
- `GET /api/account/ssh-key` — returns the current user's SSH public key `{ sshPublicKey }`, read from `<DATA_DIR>/users/<userId>/ssh/authorized_keys`. Owner-only. The SSH key is NOT stored in env-vars.json.
- `PUT /api/account/ssh-key` — writes `{ sshPublicKey }` to `<DATA_DIR>/users/<userId>/ssh/authorized_keys` (trimmed; empty string → empty file), which all of the user's workers see live through the read-only bind mount. Backed by `StorageManager.writeSshAuthorizedKeys`.
- `GET /api/account/agent-credentials` — returns `[{ agentId, fileName, configured }]` for the current user. `configured` is true when the per-user OAuth file at `<DATA_DIR>/users/<userId>/credentials/<fileName>` contains more than `{}`.
- `DELETE /api/account/agent-credentials/:agentId` — overwrites that agent's per-user OAuth file with `{}` so the next CLI login writes a fresh token. Unknown agent ids return 400.
- **Scoping**: env vars and credentials are strictly per-user. Each user's workers inherit only their own env vars; user A's worker can never read user B's tokens.
- **Worker provisioning**: when a worker is created/rebuilt/unarchived, the orchestrator resolves the worker owner's `UserEnvVars` and bind-mounts the user's three credential files directly at the CLIs' expected paths — `/home/agent/.agent-data/.claude/.credentials.json`, `/home/agent/.agent-data/.codex/auth.json`, `/home/agent/.agent-data/.gemini/antigravity-cli/antigravity-oauth-token` (Antigravity CLI's file token storage — workers have no D-Bus keyring). In directory mode, `StorageManager.ensureWorkerDirs` pre-creates the mountpoint files so Docker Desktop's virtiofs accepts the nested file bind. Writes from any of the user's workers update the same host file immediately, with no symlink indirection or restart dance.
- **Precedence inside the worker**: agent + git tokens come from the user's uniform `UserEnvVars.envVars` list (rendered verbatim by `renderUserEnvVars`); the per-environment `envVars` field is exported by the entrypoint AFTER Docker's env array, so an Environment can override any per-user var (including `GITHUB_TOKEN`).
- **User deletion cleanup**: a background `OrphanSweeper` runs at orchestrator startup and every 10 minutes; it reads the auth DB's user table and prunes any per-user `env-vars.json` row, `<DATA_DIR>/users/<userId>/` directory, and usage-state entry whose user is no longer present. Implemented as a timer rather than a middleware so nothing touches better-auth's request pipeline.

### 24.16 Logs
- `GET /api/logs` — query log entries with filters (sources, sourceIds, levels, since, until, limit, search). `since` is **inclusive** (`>=`) and `until` is **exclusive** (`<`) — paginate older by passing the oldest entry's timestamp as `until` to the next call. Returns `{ entries, hasMore }`.
- `DELETE /api/logs` — clear all log files
- `GET /api/log-sources` — list known container log sources (**admin-only**, like the rest of the Logs group — it leaks worker container/display names)
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

### 24.18 Worker-self routes (no session needed)

A dedicated set of routes mounted at `/api/worker-self/*` is **public to the auth middleware** (listed in `PUBLIC_API_PREFIXES`) but identifies the calling worker by source IP via `requireWorkerSelf()` (`server/utils/worker-auth.ts`). The orchestrator joins the same `agentor-net` Docker bridge that workers join, so each worker's source IP is unique and can be matched against the `agentor.managed=true` containers. Calls from outside the Docker bridge (e.g. host `localhost:3000`) return 401 because the source IP doesn't resolve to any managed worker.

Every mutation is scoped to the calling worker only — a `workerId` body field is not accepted, list endpoints filter by the caller's `containerName`, and delete endpoints return 403 if the targeted mapping belongs to a different worker.

The port-mapping / domain-mapping / usage routes additionally **enforce the calling worker's environment `exposeApis` flags**: the handler resolves the worker's environment and returns **403** when the relevant flag (`portMappings` / `domainMappings` / `usage`) is false. `info` and the `*-mapper/status` routes are always reachable. (This was previously documentation-only — disabling a flag now actually blocks the endpoint, not just the capability doc.)

| Method | Path | Behaviour |
|--------|------|-----------|
| `GET`  | `/api/worker-self/info` | `{ workerId, containerName, userId, status, displayName }` — `workerId` is the worker UUID (`container.id`); `displayName` is always a real, editable label |
| `GET`  | `/api/worker-self/port-mapper/status` | Total port-mapping counts |
| `GET`  | `/api/worker-self/port-mappings` | Mappings owned by the calling worker only |
| `POST` | `/api/worker-self/port-mappings` | Body: `{ externalPort, type, internalPort, appType?, instanceId? }`. Returns the created mapping with `containerName` populated from the caller. |
| `DELETE` | `/api/worker-self/port-mappings/:port` | Idempotent. 403 if the mapping is owned by a different worker. |
| `GET`  | `/api/worker-self/domain-mapper/status` | `enabled`, `baseDomains`, `baseDomainConfigs`, `totalMappings`, `hasSelfSignedCa`, `dashboardUrl` |
| `GET`  | `/api/worker-self/domain-mappings` | Mappings owned by the calling worker only |
| `POST` | `/api/worker-self/domain-mappings` | Body: `{ subdomain?, baseDomain, path?, protocol, wildcard?, internalPort, basicAuth? }`. Same validation as `/api/domain-mappings` minus `workerId` (the caller IP determines the target worker). |
| `POST` | `/api/worker-self/domain-mappings/batch` | Same per-item shape; single Traefik reconcile |
| `DELETE` | `/api/worker-self/domain-mappings/:id` | Idempotent. 403 if the mapping is owned by a different worker. |
| `GET`  | `/api/worker-self/usage` | Usage status scoped to the worker's owning userId |
| `POST` | `/api/worker-self/usage/refresh` | Force-refresh for the same userId |

The session-authenticated `/api/port-mappings`, `/api/domain-mappings`, and `/api/usage` routes still exist for the dashboard UI but are unreachable from inside a worker (no session cookie). All worker-side built-in capabilities reference the `/api/worker-self/*` form exclusively.

### 24.19 Users (admin)
- `GET /api/users` — list users (`User` shape as in §24.15a)
- `POST /api/users` — create `{ name, email, password?, role? }` (email lowercased and validated, password ≥ 8 chars, role `admin` | `user`, default `user`); duplicate email → 409
- `PATCH /api/users/:id` — update `name`, `email` (409 when taken), `role`; an admin cannot remove their own admin role (400)
- `PUT /api/users/:id/password` — set another user's password `{ newPassword }` (≥ 8 chars) without the current one; your own → 400 (use the Account modal, which requires the current password)
- `DELETE /api/users/:id` — delete the user and their sessions, then sweep all their Agentor data immediately; deleting yourself → 400
- Every route: 401 unauthenticated, 403 for non-admins, 404 unknown user. Implemented on better-auth's server API / internal adapter (the admin plugin's own endpoints only accept browser sessions)

---

## 25. UI State Persistence

### 25.1 localStorage Key
- Single key: `agentor-ui-state`
- 500ms debounced writes, flushed on `pagehide` and when the page becomes hidden (iOS Safari and backgrounded / killed PWAs never fire `beforeunload`)

### 25.2 Persisted State
- Sidebar width (persistence clamp 200–3000, runtime-clamped to 90% of viewport)
- Sidebar collapsed state
- Panel collapse states (archived, portMappings, domainMappings, usage, images, settings)
- Split pane tree (rootNode + focusedNodeId)
- Tmux active windows per container — reopening a terminal tab restores the worker's last active tmux window (falls back to the first window when it is gone)

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
- Antigravity: configured in `~/.gemini/config/mcp_config.json` under `mcpServers` (listed by `agy mcp list`)
- Write-once: user modifications to config files are preserved on restart/rebuild
- MCP packages are downloaded via `npx -y` on first agent use

### 26.2 Antigravity CLI (`agy`)
- Google Antigravity CLI replaces the Gemini CLI (shut down for personal accounts in June 2026); installed with Google's installer into `~/.local/bin/agy` and self-updating
- `~/.gemini/antigravity-cli/settings.json` (write-once) trusts `/workspace` (`trustedWorkspaces`); when the user has a `GEMINI_API_KEY` but no OAuth login it also sets `modelProvider: "gemini"` (API-key mode). A `modelProvider: "gemini"` left behind after the key was removed is dropped on the next start, because `agy` refuses to start without the key
- Instructions go to `~/.gemini/GEMINI.md` (a global rule for `agy`), capabilities to `~/.gemini/config/skills/agentor-<name>/SKILL.md`
- Login: `agy` → Google OAuth prints a URL; the user signs in in their browser and pastes the code back. The token lands in the shared per-user credential file. Onboarding (color scheme, Terms of Service) is left to the user

---

## 27. Git Identity

### 27.1 Per-User Git Config
- A worker's `git config --global user.name` and `user.email` are the **owning user's** profile (name and email from the auth system), **resolved live at build time** from the worker's `userId` (`getUserById`) — NOT stored on the worker
- The `WORKER` JSON env var includes `gitName` and `gitEmail` fields (populated with the resolved values at create/rebuild/unarchive)
- The entrypoint reads these fields via `jq` and calls `git config --global`
- `ContainerInfo` and `WorkerRecord` do **NOT** carry `gitName`/`gitEmail` — they reference the owner by `userId` only, and the identity is resolved live (normalization). The API response never exposes `gitName`/`gitEmail`.
- Git identity survives rebuild and archive/unarchive automatically (re-resolved from `userId` and re-passed in WORKER JSON), and always reflects the user's current profile
- No per-agent git wrapper — agent CLIs add `Co-authored-by` trailers to their commits for attribution
- No `/usr/local/bin/git` wrapper installed — `git` resolves to `/usr/bin/git` directly

### 27.2 Git Provider Auth in Workers
- The `WORKER` JSON env var carries `gitProviders: [{ id, type, url, tokenEnvVar, containerRegistry? }]` — every configured provider
- For each provider whose token variable is set in the worker env (the owner's account env vars, or an environment override), the entrypoint configures HTTPS credentials for that host: GitHub via `gh auth git-credential`; GitLab via a credential helper that answers `username=oauth2` + `password=$<TOKEN_VAR>` from the environment at use time — **the token is never written to `~/.gitconfig`**. Clone, pull and push work; `git@<host>:` URLs are rewritten to HTTPS
- `glab` (GitLab CLI) is installed and configured per GitLab host (token, API protocol, HTTPS git protocol; a host with a port or relative URL root gets `api_host`, and a host with a port also a bare-host entry so `glab --hostname <host>` works); `glab` works inside a clone (host from the remote) and outside with `--hostname`; update checks are disabled. Because glab lets `GITLAB_TOKEN` override every host, users with tokens for gitlab.com and a self-managed host use `env -u GITLAB_TOKEN glab …` for the latter (documented in the platform guide)
- Repo cloning: GitHub repos via `gh repo clone` when the user has a GitHub token; other providers — and GitHub without a token, so public GitHub repos clone anonymously — via `git clone`, resolving a repo path (`owner/repo`, `group/subgroup/project`) to `<provider url>/<path>.git`; full clone URLs are used as-is; the optional branch is checked out. A repo that needs credentials the worker lacks fails its clone (logged, marked failed on the loading screen) instead of blocking the boot on a credential prompt
- With Docker-in-Docker, the inner daemon logs into each provider's container registry the user has a token for (`ghcr.io`, `registry.gitlab.com`)
- Restricted network modes (all but `full` / `block-all`) allowlist every provider's hosts (`github.com`, `gitlab.com`, `*.gitlab.com`, each self-managed GitLab host)

### 27.3 Git Provider Access per Environment
- An environment's `enabledGitProviderIds` (Environments modal → Git Providers) decides which providers' credentials its workers get. For every provider it does not enable, untrusted code running there cannot reach the owner's repositories on that provider:
  - The provider's token env var (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITLAB_<NAME>_TOKEN`) is withheld from the owner's account env vars **and** dropped from the environment's own env vars. So are the CLI variables of its type (`GH_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN` for GitHub; `GITLAB_ACCESS_TOKEN`, `OAUTH_TOKEN` for GitLab) — gh / glab use those for any host, so they go as soon as one provider of the type is not enabled. An enabled provider's own token variable is never withheld; all other env vars (agent API keys, custom vars) are passed as usual
  - git has no credential helper for its host, gh / glab are not signed in to it, and the Docker-in-Docker daemon does not log into its registry
  - Credentials an earlier boot left behind for it (its git credential helper, gh `hosts.yml` / glab `config.yml`, its registry login — e.g. from a rootfs restored from an export) are removed on every start; enabled GitLab hosts are configured again right after
  - Its public repositories still clone; private ones fail to clone. The git identity (name/email) is still configured
- Enabled providers work exactly as in §27.2. `ENVIRONMENT.enabledGitProviderIds` inside the worker is the resolved list of enabled provider ids (never null); the platform guide tells agents what it means
- Like other environment settings it applies on create / rebuild / unarchive / import — a changed selection takes effect on a worker's next rebuild

---

## 28. Worker Export / Import

### 28.1 Export
- The worker card's **Export** button (in the workspace group, running-only) downloads a single `.tar` bundle (`<displayName>-worker-export.tar`) via `GET /api/containers/:id/export`. The button uses `fetch` (not a bare anchor) so it can show a spinner + disable while the server materialises the bundle (which is slow when the `docker export` rootfs is included), then saves the response via a blob URL.
- Bundle layout (outer uncompressed tar): `manifest.json` + `workspace.tar.gz` + `agents.tar.gz`, and (when `includeRootfs` is true — the default) `rootfs.tar.gz` (a `docker export` of the container filesystem, gzipped).
- The manifest embeds the worker's own config (displayName, repos, mounts, initScript), the **full environment definition** (so it restores on another machine), and the worker's port + domain mappings (stripped of identity).
- Per-user OAuth credential files (`.claude/.credentials.json`, `.codex/auth.json`, `.gemini/antigravity-cli/antigravity-oauth-token`) are **stripped** from `agents.tar.gz` — an export never carries another user's tokens.
- Validation: 401 unauth, 403 cross-user, 404 unknown worker; the worker must be running or stopped (archived workers have no container to export).

### 28.2 Import
- The sidebar **Import worker** button opens the Import Worker modal (dialog named "Import Worker"; full-screen sheet with a sticky Import / Cancel row on phones): a file picker for the `.tar` bundle (`data-testid="import-file"`, labelled "Export bundle"), an optional Display name (`data-testid="import-name"`, labelled "Display name" — clicking a label focuses / opens its input), and an **Import** button (`data-testid="import-submit"`, disabled until a file is chosen). Errors are announced (`role="alert"`).
- Import streams the bundle as the raw request body to `POST /api/containers/import` (no multipart buffering — bundles can be multi-GB), creates a **brand-new worker** (fresh UUID, `containerName = agentor-worker-<id>`), and on success opens a terminal tab for it.
- Restore steps: resolve/create the environment (built-in reused by id; a user's same-named env reused; otherwise the embedded definition is recreated as a new custom env) → import `rootfs.tar.gz` into a per-worker image (`agentor-import-<id>`) when present, replicating the standard image's entrypoint/env so it boots — **falls back to the standard worker image if the rootfs import fails** → create the container stopped → restore the workspace + agent-data volumes via `putArchive` → start → recreate port/domain mappings (skipping conflicts and base domains not configured on this machine).
- A worker restored with a captured filesystem persists its per-worker image link (`importedImage` on the WorkerRecord) so the rootfs survives rebuild/unarchive; the image is removed on permanent delete.
- Validation: 400 on an invalid/garbage bundle, 401 unauth. The displayName override (`?displayName=`) sets the restored worker's label.

---

## 29. MCP Server

### 29.1 Endpoint & protocol
- MCP server at `<public URL>/mcp` (Streamable HTTP; stateless — serves both the 2025-era and the 2026-07-28 protocol revisions; GET/DELETE → 405). The public URL is configured via `.env.example` (`BETTER_AUTH_URL`; defaults to the Traefik dashboard URL, else `http://localhost:3000`)
- Enabled unless `MCP_ENABLED=false`; automatically disabled (404, reason in System Settings) when the public URL is plain http on a non-loopback host
- Server info `agentor`; the initialize result carries **instructions**: what Agentor is, core concepts (workers, environments, capabilities, instructions, init scripts, port/domain mappings, apps, archive vs delete, account), typical workflows referencing real tool names, and rules of thumb. The same guide is readable as the resource `agentor://guide` (`text/markdown`)

### 29.2 Authorization (OAuth 2.1)
- Unauthenticated requests → 401 with `WWW-Authenticate: Bearer resource_metadata="<public URL>/.well-known/oauth-protected-resource/mcp", scope="agentor"`
- Protected-resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource`: `resource` = the MCP URL, `authorization_servers` = [`<public URL>/api/auth`], `scopes_supported` = [`agentor`]
- Authorization-server metadata (RFC 8414) at `/.well-known/oauth-authorization-server/api/auth` (and `/api/auth/.well-known/…`): authorize / token / registration / JWKS / introspection / revocation endpoints, `S256` PKCE, scopes `openid profile email offline_access agentor`, Client ID Metadata Documents supported
- Clients register via Dynamic Client Registration (`POST /api/auth/oauth2/register`, no session needed; clients with only http loopback redirect URIs are treated as native apps) or CIMD
- Users sign in on `/login` and approve on `/oauth/consent` (§0.13); access tokens are JWTs bound to the MCP resource with scope `agentor` (full access as the user); `offline_access` adds refresh tokens
- Every MCP request re-checks the user (deleted or banned → 401) and the user's consent for the client (revoked → 401) — revocation is immediate even for unexpired tokens

### 29.3 Tools
- Generated at runtime from the REST API's OpenAPI spec (`/api/docs/openapi.json`) with `mcp-from-openapi`: one tool per documented route (`snake_case(operationId)`, e.g. `create_container`, `exec_command`, `send_tmux_keys`, `capture_tmux_window`, `get_desktop_screenshot`, `send_desktop_input`, `upload_to_workspace`, `download_workspace`, `list_git_providers`, `list_git_repos`, `list_git_branches`, `create_git_repo`, `list_users`, …) — ~97 tools for an admin
- Excluded: worker-self, setup, health and internal proxy/WebSocket routes, and routes marked `x-mcp: false` (own-password set/remove, worker export/import)
- Admin-only routes (`x-admin-only`) are hidden from regular users' tool lists (users, logs, settings, updates)
- Input schemas = path + query + JSON body parameters from the route metadata (enums, required fields, descriptions); tool descriptions = summary + description; annotations from the HTTP method (GET read-only, DELETE destructive, …); arguments violating the schema are rejected before the route runs
- Execution: each call is re-dispatched (loopback HTTP) to the REST route as the calling user (single-use internal capability), so validation, ownership (403 for other users' resources) and side effects are identical to the dashboard
- Results: JSON → pretty-printed text; `text/*` → text; images → image content (desktop screenshot); other binaries (workspace `.tar.gz`) → embedded blob resource; any response body above 16 MiB is abandoned while streaming and reported as a tool error; route errors → tool error `HTTP <status>: <message>`

