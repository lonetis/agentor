# Authentication & Authorization

Agentor uses [better-auth](https://www.better-auth.com/) with its admin plugin for email/password authentication and role-based access control. All API endpoints and WebSocket connections are protected by default — only `/api/health`, `/api/setup/**`, `/api/auth/**`, and `/api/docs` are public.

## First-Run Setup

On a fresh install, the SQLite auth database is empty. Navigating to any page redirects to `/setup`, where the first user is created and automatically promoted to `admin`. This is the only way to create the initial admin — the `create-admin` endpoint is disabled once any user exists (returns 409).

After the initial admin, additional users (with `user` or `admin` role) can be created by an existing admin via the Users modal in the sidebar, which uses better-auth's admin plugin endpoints under `/api/auth/admin/*`.

## Roles

Two roles: `admin` and `user`.

- **admin** — sees and manipulates all resources across all users, manages other users, and accesses admin-only endpoints (system settings, updates, logs).
- **user** — sees only their own resources plus built-in/global ones (seeded capabilities, instructions, init scripts, environments).

## Resource Ownership

User-owned resources carry a `userId` field populated from the authenticated session on creation. Each user's data lives in its own subtree under `<DATA_DIR>/users/<userId>/`:

| Resource | Storage | Owner |
|----------|---------|-------|
| Workers | `users/<userId>/workers.json` | `WorkerRecord.userId` |
| Port mappings | `users/<userId>/port-mappings.json` | `PortMapping.userId` (copied from the target worker) |
| Domain mappings | `users/<userId>/domain-mappings.json` | `DomainMapping.userId` (copied from the target worker) |
| Custom environments | `users/<userId>/environments.json` | `Environment.userId` |
| Custom capabilities | `users/<userId>/capabilities.json` | `Capability.userId` |
| Custom instructions | `users/<userId>/instructions.json` | `Instruction.userId` |
| Custom init scripts | `users/<userId>/init-scripts.json` | `InitScript.userId` |
| Env vars | `users/<userId>/env-vars.json` | file path is the owner id |
| Usage state | `users/<userId>/usage.json` | file path is the owner id |
| OAuth credentials | `users/<userId>/credentials/{claude,codex,gemini}.json` | file path is the owner id |
| Worker workspace (dir mode) | `users/<userId>/workspaces/<name>/` | owned by the worker |
| Worker agent data (dir mode) | `users/<userId>/agents/<name>/` | owned by the worker |

Built-in, platform-seeded resources live separately at `<DATA_DIR>/defaults/{environments,capabilities,instructions,init-scripts}.json` with `userId: null`. They are re-seeded on every orchestrator startup from `server/built-in/` and are globally visible; mutation attempts (update/delete) return 400.

List endpoints merge the `defaults/` store and the caller's per-user store: admins see every user's data plus built-ins, regular users see their own rows plus `userId === null`. Single-resource endpoints (GET/PUT/DELETE) verify ownership (`user.id === resource.userId` or admin role) and return 403 for unauthorized access.

A background orphan sweeper (`server/utils/orphan-sweeper.ts`) runs at startup and every 10 minutes: it reads the auth DB's `user` table and, for any candidate `userId` present in any per-user store whose row is no longer in the auth DB, drops that user from every in-memory store and recursively removes `<DATA_DIR>/users/<userId>/` — taking workspaces, agent dirs, credentials, and every per-user JSON file with it.

## Architecture

### Database

better-auth stores users, sessions, accounts, and verification tokens in `<DATA_DIR>/auth.db` (SQLite). Migrations run automatically on startup via `getMigrations()`.

Application data remains in JSON files (via `JsonStore`) — we only use SQLite for auth. This keeps the unit of persistence (a single file per store) unchanged.

### Server

| Component | File | Purpose |
|-----------|------|---------|
| Auth instance | `orchestrator/server/utils/auth.ts` | `betterAuth()` configuration with admin plugin, session config, and migration runner |
| Auth handler | `orchestrator/server/api/auth/[...all].ts` | Catch-all that forwards `/api/auth/*` to `auth.handler()` |
| Middleware | `orchestrator/server/middleware/auth.ts` | Global Nitro middleware that extracts the session on every `/api/*` request and populates `event.context.auth`. Skips `/api/auth/**`, `/api/health`, `/api/setup/**`, `/api/docs`, and `/api/worker-self/**`. |
| Helpers | `orchestrator/server/utils/auth-helpers.ts` | `requireAuth(event)`, `requireAdmin(event)`, `requireContainerAccess(event, container)`, `canAccessResource(...)`, `authenticateWsPeer(peer)` |
| Worker auth | `orchestrator/server/utils/worker-auth.ts` | `requireWorkerSelf(event)` — identifies the calling worker by source IP on the `agentor-net` Docker bridge network. Used by every `/api/worker-self/*` route in place of session auth. |
| Setup endpoints | `orchestrator/server/api/setup/status.get.ts` + `create-admin.post.ts` | First-run detection and initial admin creation |

### Secret

`BETTER_AUTH_SECRET` (env var) is used to sign session cookies. If unset, a random 32-byte secret is generated on first run and persisted to `<DATA_DIR>/auth.secret` so sessions survive restarts without requiring manual secret management.

### WebSocket Authentication

WebSocket upgrade requests include the browser's session cookie automatically. The `authenticateWsPeer()` helper reads the cookie from `peer.request.headers`, calls `auth.api.getSession({ headers })`, and returns the auth context or `null`.

Applied to:
- `server/utils/terminal-handler.ts` — terminal WS (`/ws/terminal/:id[/:windowIndex]`)
- `server/utils/ws-utils.ts` — relay handlers used by editor (`/editor/:id/**`) and desktop (`/ws/desktop/:id`) — validates session + container ownership before opening the backend connection
- `server/routes/ws/logs.ts` — log stream (admin-only)
- `server/routes/editor/[containerId]/**` — code-server HTTP proxy (checks session + container ownership on every request)
- `server/routes/desktop/[containerId]/**` — noVNC HTTP proxy (checks session + container ownership on every request)

### Client

| Component | File | Purpose |
|-----------|------|---------|
| Auth composable | `orchestrator/app/composables/useAuth.ts` | Wraps `createAuthClient` from `better-auth/vue` + `adminClient()`; exposes `session`, `user`, `isLoggedIn`, `isAdmin`, `signIn`, `signOut`, `client` |
| Route guard | `orchestrator/app/middleware/auth.global.ts` | Global Nuxt route middleware — redirects to `/setup` on first run, `/login` when no session |
| Login page | `orchestrator/app/pages/login.vue` | Email/password form; calls `client.signIn.email()` and redirects to `/` |
| Setup page | `orchestrator/app/pages/setup.vue` | Initial admin creation form; calls `POST /api/setup/create-admin` then signs in |
| Users modal | `orchestrator/app/components/UsersModal.vue` | Admin-only user management — list, create, change role, delete |
| Sidebar footer | `orchestrator/app/components/AppSidebar.vue` | Account info + sign out button pinned to the bottom of the sidebar (always visible, outside the tab content) |

## Admin-only Endpoints

- `GET /api/settings` — system configuration
- `GET/DELETE /api/logs` — log query + clear
- `POST /api/updates/apply`, `/check`, `/prune` — image updates
- `POST /api/auth/admin/*` — user management (create, list, setRole, remove, ban/unban)
- `WS /ws/logs` — live log stream

All other authenticated endpoints are accessible to both admins and regular users (subject to resource ownership).

## Worker-Self Endpoints (no session needed)

A dedicated set of endpoints under `/api/worker-self/*` is reachable from inside worker containers **without any session cookie or API key**. These are listed in `PUBLIC_API_PREFIXES` in `server/middleware/auth.ts` so they bypass session validation entirely.

Each `/api/worker-self/*` handler instead calls `requireWorkerSelf(event)` from `server/utils/worker-auth.ts`, which:

1. Reads the source IP from `event.node.req.socket.remoteAddress` (stripping any `::ffff:` IPv4-mapped prefix).
2. Lists managed Docker containers (filtered by `agentor.managed=true`) and matches each container's IP on `dockerNetwork` (`agentor-net`) against the source IP. The IP→containerName map is cached for 3 seconds; a miss forces a refresh.
3. Resolves the matched containerName back to an in-memory `ContainerInfo` via `containerManager.findByContainerName()`. If the container is not in `running` state, returns 409.
4. Returns `{ container, userId, containerName, workerName }`.

Every `/api/worker-self/*` mutation is therefore scoped to the calling worker only — `workerId` / `workerName` body fields are ignored, list endpoints filter by the caller's `containerName`, and delete endpoints reject (403) operations that would touch a different worker's mappings.

Routes:

| Method | Path | Notes |
|--------|------|-------|
| `GET`  | `/api/worker-self/info` | `{ workerName, containerName, userId, status, displayName }` for diagnostics |
| `GET`  | `/api/worker-self/port-mapper/status` | Counts of all port mappings (read-only) |
| `GET`  | `/api/worker-self/port-mappings` | Only mappings owned by the calling worker |
| `POST` | `/api/worker-self/port-mappings` | Creates a port mapping for the calling worker |
| `DELETE` | `/api/worker-self/port-mappings/:port` | 403 if mapping belongs to a different worker |
| `GET`  | `/api/worker-self/domain-mapper/status` | `enabled`, `baseDomains`, `baseDomainConfigs`, etc. |
| `GET`  | `/api/worker-self/domain-mappings` | Only mappings owned by the calling worker |
| `POST` | `/api/worker-self/domain-mappings` | Creates a domain mapping for the calling worker |
| `POST` | `/api/worker-self/domain-mappings/batch` | Batch create (single Traefik reconcile) |
| `DELETE` | `/api/worker-self/domain-mappings/:id` | 403 if mapping belongs to a different worker |
| `GET`  | `/api/worker-self/usage` | Usage status scoped to the worker's owning userId |
| `POST` | `/api/worker-self/usage/refresh` | Force refresh for the same userId |

This is the only API surface workers should hit — the dashboard-facing `/api/port-mappings`, `/api/domain-mappings`, and `/api/usage` routes still require a session cookie that workers do not have.

The Docker-bridge identification is safe because joining `agentor-net` requires Docker socket access (the orchestrator/operator), and Docker IPAM assigns a unique IP per container. A container removed and replaced with a new one on the same IP cannot impersonate the previous worker — the cache is verified against `containerManager.findByContainerName()`, which only returns running, registered workers.

## Layered Auth (Basic Auth)

The existing Traefik dashboard basic auth (`DASHBOARD_AUTH_USER` / `DASHBOARD_AUTH_PASSWORD`) still works as an **additional** protection layer in front of the orchestrator. It operates at the reverse proxy level — if enabled, users must pass basic auth first, then sign in with their Agentor account. The two are independent and complementary.

## Testing

Tests run as admin by default via Playwright's `globalSetup`:

1. `tests/global-setup.ts` — runs once before all tests. Polls `/api/health`, creates the admin user if needed via `/api/setup/create-admin`, signs in, and saves the session cookies to `tests/.auth/admin-api.json` (for API tests) and `tests/.auth/admin-ui.json` (for UI tests).
2. `tests/playwright.config.ts` — points each project's `storageState` at the corresponding saved file, so every test's `request` / `page` fixture is pre-authenticated.

### Testing authentication flows

- `tests/api/auth.spec.ts` — sign in, sign out, session retrieval, 401 responses on protected endpoints, Origin header enforcement.
- `tests/api/setup.spec.ts` — setup status endpoint, 409 when users already exist, email validation.
- `tests/api/authorization.spec.ts` — admin vs user access, ownership filtering, admin-only endpoint rejection.

### Fresh unauthenticated contexts

Tests that need to test unauthenticated behavior or a specific user session use `playwrightRequest.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { Origin: BASE_URL } })` to bypass the project-level admin session. The Origin header is required because better-auth rejects POST requests without an Origin/Referer as CSRF protection.

### Terminal WebSocket auth

The `TerminalWsClient` helper reads cookies from `tests/.auth/admin-api.json` and passes them as a `Cookie` header on the WebSocket upgrade so terminal tests connect as admin without additional setup.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BETTER_AUTH_SECRET` | auto-generated | Session signing secret. If empty, a random 32-byte hex is generated and written to `<DATA_DIR>/auth.secret` on first run. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Base URL used by better-auth for cookie domain and default trusted origin. Override for production deployments. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | — | Extra comma-separated origins to accept on auth mutations' `Origin` header. `localhost:3000`, `127.0.0.1:3000`, `BETTER_AUTH_URL`, and the dashboard subdomain (`DASHBOARD_SUBDOMAIN.DASHBOARD_BASE_DOMAIN`, both http and https) are always trusted automatically. |
| `BETTER_AUTH_RP_ID` | `${DASHBOARD_SUBDOMAIN}.${DASHBOARD_BASE_DOMAIN}` | WebAuthn Relying Party ID for passkeys. Only relevant when passkeys are enabled (i.e., when the dashboard is served over Traefik). Override to use a parent domain so one passkey works across multiple subdomains. |

## Passkeys

Agentor supports passkey (WebAuthn) authentication via the [better-auth passkey plugin](https://www.better-auth.com/docs/plugins/passkey). Users can sign up with a passkey only, sign in with a passkey only, or use both alongside a password. The two credential types are fully orthogonal, with one invariant enforced server-side: **every user must always have at least one credential** — you cannot remove the last passkey if no password is set, and you cannot remove the password if no passkey is registered.

### When passkeys are enabled

WebAuthn requires a stable HTTPS origin and binds credentials to an `rpID`. Agentor only registers the passkey plugin when **both** `DASHBOARD_SUBDOMAIN` and `DASHBOARD_BASE_DOMAIN` are set — i.e., the dashboard is reachable at `https://<subdomain>.<base>` via Traefik. When either is missing, the passkey plugin is not registered at all and all passkey UI is hidden via the `passkeysEnabled` flag on `/api/setup/status`.

The auto-derived passkey config, when enabled:

| Field | Value |
|-------|-------|
| `rpID` | `${DASHBOARD_SUBDOMAIN}.${DASHBOARD_BASE_DOMAIN}` (override with `BETTER_AUTH_RP_ID`) |
| `origin` | `https://${DASHBOARD_SUBDOMAIN}.${DASHBOARD_BASE_DOMAIN}` |
| `rpName` | `Agentor` |

This means users **must** access the dashboard via the Traefik URL (not via `localhost:3000` or a raw IP) for passkey flows to work — the browser will reject any WebAuthn ceremony whose `rpID` doesn't match its current origin.

The `/api/setup/status` endpoint returns a `passkeysEnabled: boolean` flag that the client uses to conditionally render passkey UI. When disabled:
- Setup page hides the Password/Passkey toggle and forces password mode.
- Login page hides the "Sign in with passkey" button and skips conditional UI auto-fill.
- Account modal hides the entire Passkeys section and disables the "Remove password" button.

### Where it shows up in the UI

| Surface | Behavior |
|---------|----------|
| **Setup page** | Toggle between **Password** and **Passkey** mode. The passkey path requests a one-shot setup token from `/api/setup/create-admin-passkey-token`, then calls `client.passkey.addPasskey({ context: token })` — this creates the admin user and binds the credential in a single browser ceremony. |
| **Login page** | "Sign in with passkey" button below the password form. Conditional UI auto-fill is also enabled (browsers that support it offer the passkey when the user focuses an input), but is disabled under `navigator.webdriver` to avoid races in tests. |
| **Account modal — Passkeys section** | Lists registered passkeys with name, creation date, and a Remove button (with two-step confirmation). "Add passkey" button calls `client.passkey.addPasskey({ name })`. |
| **Account modal — Password section** | Heading switches between "Change password" and "Set a password" depending on `credentials.hasPassword`. "Remove password" button (two-step confirm) is shown only when the user also has at least one passkey. |
| **Users modal (admin)** | Existing user management — admins can still create users with or without a password and reset passwords. Passkeys are managed by the user themselves (admins cannot remotely register a passkey for someone else). |

### Passkey-first registration (the `resolveUser` callback)

The passkey plugin's `registration.requireSession` is `false`, which means the registration endpoint accepts an opaque `context` token instead of an existing session. The `resolveUser` callback in `auth.ts` consumes that token via `setup-token-store.ts`:

1. Client calls `POST /api/setup/create-admin-passkey-token` with `{ email, name }`. Server validates that no users exist yet, generates a 32-byte hex token, stores it with a 5-minute TTL.
2. Client calls `client.passkey.addPasskey({ name, context: token })` — better-auth runs the WebAuthn ceremony in the browser, then calls back to the server's verify endpoint with the same `context`.
3. The server's `resolveUser` callback consumes the token, creates the user (no password) directly via the better-auth adapter, and returns `{ id, name }` so the plugin can bind the new credential.
4. The client signs in with the passkey to establish the session.

### Credential balance enforcement

Two layers of protection prevent users from locking themselves out:

1. **`POST /api/account/remove-password`** — Agentor's wrapper endpoint that refuses to remove the password unless the user has at least one passkey (returns 409).
2. **`server/middleware/passkey-guard.ts`** — Nitro middleware that intercepts `POST /api/auth/passkey/delete-passkey`. If deleting the targeted passkey would leave the user with zero credentials (no password AND only one passkey), the request is rejected with 409.

The client also enforces this defensively in the Account modal: the Remove button on the only passkey is disabled when the user has no password, and the "Remove password" button only appears when at least one passkey is registered.

### Custom server endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/account/credentials` | Returns `{ hasPassword, passkeyCount }` for the current user. Used by the Account modal to drive UI state. |
| `POST /api/account/remove-password` | Removes the user's password credential. Refuses if no passkey is registered. |
| `POST /api/account/set-password` | Sets a new password without requiring a current one. Wraps better-auth's server-only `setPassword` endpoint. |
| `POST /api/setup/create-admin-passkey-token` | Issues a one-shot 5-minute token for first-run admin registration via passkey. Refused after the first user is created. |

### Testing passkeys with virtual WebAuthn

The passkey UI tests use Chrome DevTools Protocol's virtual WebAuthn authenticator, installed via `tests/helpers/webauthn.ts`:

```ts
import { installVirtualAuthenticator } from '../helpers/webauthn';

const auth = await installVirtualAuthenticator(page);
try {
  // ... drive the passkey UI flow ...
  // The virtual authenticator returns canned biometric results so the
  // browser's WebAuthn ceremony completes without any real prompt.
} finally {
  await auth.dispose();
}
```

Tests live in `tests/ui/passkey-management.spec.ts` and `tests/api/passkey.spec.ts`. They cover: registering a passkey from the account modal, signing in with a registered passkey, removing a password after adding a passkey, the "cannot remove last passkey" guard, and setting a password after going passwordless.

## Trusted Origins & CSRF

better-auth rejects any POST to `/api/auth/*` without an `Origin` or `Referer` header, and rejects requests whose origin isn't in `trustedOrigins` — this is its CSRF protection. The trusted list is built automatically on startup:

1. `http://localhost:3000` + `http://127.0.0.1:3000` (direct dev access)
2. `BETTER_AUTH_URL` if set
3. `http(s)://<DASHBOARD_SUBDOMAIN>.<DASHBOARD_BASE_DOMAIN>` when configured via Traefik
4. Anything listed in `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated)

If you see `[Better Auth]: Invalid origin: https://foo.example.com` in the orchestrator logs, that origin isn't in the list — either set it via `BETTER_AUTH_URL` / `DASHBOARD_SUBDOMAIN` + `DASHBOARD_BASE_DOMAIN` or add it explicitly to `BETTER_AUTH_TRUSTED_ORIGINS`.
