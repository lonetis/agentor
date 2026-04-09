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

User-owned resources carry a `userId` field populated from the authenticated session on creation:

| Resource | Storage | Owner field |
|----------|---------|-------------|
| Workers | `workers.json` | `WorkerRecord.userId` |
| Port mappings | `port-mappings.json` | `PortMapping.userId` (copied from the target worker) |
| Domain mappings | `domain-mappings.json` | `DomainMapping.userId` (copied from the target worker) |
| Environments | `environments.json` | `Environment.userId` (or `null` for built-ins) |
| Capabilities | `capabilities.json` | `Capability.userId` (or `null` for built-ins) |
| Instructions | `instructions.json` | `Instruction.userId` (or `null` for built-ins) |
| Init scripts | `init-scripts.json` | `InitScript.userId` (or `null` for built-ins) |

Built-in resources seeded from `server/built-in/` always have `userId: null` — they are globally visible and read-only for everyone.

List endpoints filter by ownership: admins see everything, regular users see their own + `userId === null`. Single-resource endpoints (GET/PUT/DELETE) verify ownership and return 403 for unauthorized access.

## Architecture

### Database

better-auth stores users, sessions, accounts, and verification tokens in `<DATA_DIR>/auth.db` (SQLite). Migrations run automatically on startup via `getMigrations()`.

Application data remains in JSON files (via `JsonStore`) — we only use SQLite for auth. This keeps the unit of persistence (a single file per store) unchanged.

### Server

| Component | File | Purpose |
|-----------|------|---------|
| Auth instance | `orchestrator/server/utils/auth.ts` | `betterAuth()` configuration with admin plugin, session config, and migration runner |
| Auth handler | `orchestrator/server/api/auth/[...all].ts` | Catch-all that forwards `/api/auth/*` to `auth.handler()` |
| Middleware | `orchestrator/server/middleware/auth.ts` | Global Nitro middleware that extracts the session on every `/api/*` request and populates `event.context.auth`. Skips `/api/auth/**`, `/api/health`, `/api/setup/**`, `/api/docs`. |
| Helpers | `orchestrator/server/utils/auth-helpers.ts` | `requireAuth(event)`, `requireAdmin(event)`, `requireContainerAccess(event, container)`, `canAccessResource(...)`, `authenticateWsPeer(peer)` |
| Setup endpoints | `orchestrator/server/api/setup/status.get.ts` + `create-admin.post.ts` | First-run detection and initial admin creation |

### Secret

`BETTER_AUTH_SECRET` (env var) is used to sign session cookies. If unset, a random 32-byte secret is generated on first run and persisted to `<DATA_DIR>/.auth-secret` so sessions survive restarts without requiring manual secret management.

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
| `BETTER_AUTH_SECRET` | auto-generated | Session signing secret. If empty, a random 32-byte hex is generated and written to `<DATA_DIR>/.auth-secret` on first run. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Base URL used by better-auth for cookie domain and default trusted origin. Override for production deployments. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | — | Extra comma-separated origins to accept on auth mutations' `Origin` header. `localhost:3000`, `127.0.0.1:3000`, `BETTER_AUTH_URL`, and the dashboard subdomain (`DASHBOARD_SUBDOMAIN.DASHBOARD_BASE_DOMAIN`, both http and https) are always trusted automatically. |

## Trusted Origins & CSRF

better-auth rejects any POST to `/api/auth/*` without an `Origin` or `Referer` header, and rejects requests whose origin isn't in `trustedOrigins` — this is its CSRF protection. The trusted list is built automatically on startup:

1. `http://localhost:3000` + `http://127.0.0.1:3000` (direct dev access)
2. `BETTER_AUTH_URL` if set
3. `http(s)://<DASHBOARD_SUBDOMAIN>.<DASHBOARD_BASE_DOMAIN>` when configured via Traefik
4. Anything listed in `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated)

If you see `[Better Auth]: Invalid origin: https://foo.example.com` in the orchestrator logs, that origin isn't in the list — either set it via `BETTER_AUTH_URL` / `DASHBOARD_SUBDOMAIN` + `DASHBOARD_BASE_DOMAIN` or add it explicitly to `BETTER_AUTH_TRUSTED_ORIGINS`.
