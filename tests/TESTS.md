# Agentor Test Suite

Comprehensive end-to-end test suite for the Agentor platform using Playwright and TypeScript. Covers all API endpoints and UI interactions.

## Overview

- **~1276 tests** across 89 test files (~724 API + ~552 UI)
- **API tests**: headless, no browser needed, fast execution
- **UI tests**: Desktop Chrome (1920x1080), real browser interactions
- **Terminal tests**: WebSocket-based command execution and agent CLI prompting
- Parallel execution with up to 8 workers (configurable)
- All tests independent and self-cleaning
- **All tests run pre-authenticated as an admin user** via Playwright's `globalSetup` (see `tests/global-setup.ts`). The session cookies are saved to `tests/.auth/admin-api.json` and `tests/.auth/admin-ui.json`, referenced by the API and UI project `storageState` respectively.

## Prerequisites

- Node.js 22+
- Agentor dev environment running (`docker compose -f docker-compose.dev.yml up`)
- Orchestrator accessible at `http://localhost:3000`

## Setup

```bash
cd tests
npm install
npx playwright install chromium
```

## Running Tests

```bash
# All tests (API + UI)
npm test

# API tests only (no browser needed)
npm run test:api

# UI tests only
npm run test:ui

# UI tests with visible browser
npm run test:headed

# UI debug mode (headed, slow motion, single worker)
npm run test:debug

# Record traces for all tests (not just failures)
npm run test:trace

# Specific test file
npx playwright test api/health.spec.ts

# View HTML report after run
npm run test:report
```

Failed tests automatically capture traces, video, and screenshots (saved in `test-results/`, viewable in the HTML report). All tests get 1 retry locally, 2 in CI. See [docs/testing.md](../docs/testing.md) for full debugging options.

### Dockerized runs (isolated, no host pollution)

The host runs above need an orchestrator on `localhost:3000`, which conflicts with the developer's local manual-review instance. The dockerized runner spawns a fresh isolated agentor stack inside its own `dockerd` (DinD), runs the suite against it, and tears it down — no host ports, no shared docker state.

```bash
# All tests in the dockerized runner
npm run test:docker

# API or UI subset
npm run test:docker:api
npm run test:docker:ui

# Single file or any playwright args (note the `--` to forward args)
npm run test:docker -- api/health.spec.ts
npm run test:docker -- ui/dashboard.spec.ts --project=ui
npm run test:docker -- -g "should create worker"

# Wipe the cached dockerd volume (force a cold rebuild of agentor images)
npm run test:docker:clean
```

The runner uses `docker.localhost` and `docker2.localhost` as base domains with self-signed wildcard certs, dashboard at `https://dash.docker.localhost`. Traefik publishes 80/443 inside the runner's own network namespace, and `*.localhost` resolves to `127.0.0.1` so playwright reaches it without any `/etc/hosts` setup. The runner's `agentor-test-runner-docker` volume persists between runs so the inner image builds are cached — first run is slow, subsequent runs start fast. Reports and `.auth` cookies are written back to `tests/` on the host because the project source is bind-mounted into the runner. Works under triple-nested DinD (host → user's worker → test-runner → inner orchestrator → inner workers) since every level uses overlay2 on a volume.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Orchestrator URL |
| `CI` | - | Set to reduce workers to 1 |

## Test Structure

```
tests/
  playwright.config.ts     # Playwright configuration (api + ui projects)
  package.json             # Dependencies and scripts
  tsconfig.json            # TypeScript configuration
  helpers/
    api-client.ts          # Typed wrapper for all API endpoints
    worker-lifecycle.ts    # Container create/cleanup utilities
    ui-helpers.ts          # Page navigation and interaction helpers
    terminal-ws.ts         # WebSocket terminal client + ANSI stripping + credential checks
  api/                     # API endpoint tests (~719 tests across 51 files)
  ui/                      # UI interaction tests (~563 tests across 44 files)
```

## Test Categories

### API Tests (~724 tests, 50 files)

| File | Tests | Coverage |
|------|-------|----------|
| `auth.spec.ts` | 7 | Session retrieval with admin project cookies, unauthenticated 401 on protected API, public endpoints (/api/health, /api/setup/status), sign-in with wrong/correct credentials, sign-out clears session |
| `setup.spec.ts` | 4 | Setup status after admin exists, public access, 409 when users already exist, email validation |
| `authorization.spec.ts` | 5 | Admin lists all containers, regular user sees only own workers, regular user 403 on admin's container mutation, unauth mutation 401, admin-only endpoints reject non-admin |
| `account.spec.ts` | 5 | User changes own password (old fails, new works), change-password rejects wrong current password, user changes own email, user updates own name, admin resets another user's password via `/api/auth/admin/set-user-password` |
| `account-extended.spec.ts` | 7 | set-password rejects short/missing passwords, set-password requires auth, set-password returns 400 when password already exists, change-password rejects wrong current, remove-password idempotent 409, credentials endpoint shape |
| `passkey.spec.ts` | 7 | Credential summary endpoint requires auth, admin/user credential summary shape, remove-password rejected when no passkey, remove-password requires auth, passkey-token endpoint 409 when users exist, validation gating |
| `csrf.spec.ts` | 4 | Sign-in without Origin header rejected (403), sign-in with trusted Origin accepted, change-password without Origin rejected (even with valid session), sign-up Origin enforcement |
| `sessions.spec.ts` | 6 | Sign-in returns user metadata with role, get-session without cookie returns null, multiple sessions for same user coexist, sign-out scoped to single context, admin session reports admin role, sign-in with nonexistent email fails |
| `admin-users.spec.ts` | 10 | Admin lists users via admin plugin, regular user cannot list users, admin creates user (with / without password), admin promotes + demotes user, admin removes user, admin sets user password, regular user cannot create users or reset passwords, duplicate email rejected |
| `admin-endpoints.spec.ts` | 6 | /api/settings, /api/logs (GET+DELETE), /api/updates/apply, /api/updates/check, /api/updates/prune — each verified as admin-only (401 unauth, 403 user, 200 admin) |
| `ownership.spec.ts` | 10 | Per-user ownership filtering for environments, capabilities, instructions, init-scripts, port mappings, domain mappings, archived workers — built-in resources shared, built-in cannot be modified by non-admin, admin sees all users' resources |
| `ws-auth.spec.ts` | 4 | Terminal WS rejects unauth, logs WS rejects unauth, logs WS accepts admin, logs WS rejects regular user (admin-only stream) |
| `health.spec.ts` | 4 | Health check endpoint, container count validation, exact status 'ok', no sensitive info exposure |
| `containers.spec.ts` | 47 | CRUD, validation, field completeness, name format, stop/restart/archive/delete on non-existent, logs (running/stopped/non-empty/non-numeric tail graceful default), memoryLimit, initScript, environmentId, dockerEnabled, displayName persistence, state transitions (double-stop, restart running, archive stopped), list exclusion, response fields, snapshotted environment data fields, no labels |
| `containers-edge-cases.spec.ts` | 11 | Edge case container operations, port mappings survive stop + restart |
| `rebuild.spec.ts` | 12 | Rebuild running/stopped container, preserves metadata (name, displayName, createdAt, initScript, environment config), returns new container ID, removes old ID from list, preserves port mappings across rebuild (keyed by the stable `containerName`), non-existent container error, response field completeness |
| `tmux-panes.spec.ts` | 29 | Window CRUD, name validation, main window protection, duplicates, rename verify, whitespace name, non-existent container, auto-generated name format, rename/delete idempotency, main always present, 50-char name, rename main behavior, missing newName in body |
| `apps.spec.ts` | 23 | App lifecycle (socks5 start/stop, chromium), error handling (invalid type, non-existent container/instance), response fields (id/port on start, instance fields on list, ok on stop), VS Code tunnel singleton (app-type shape, start returns id=`vscode`+port=0, second start returns 409, list status in `{running, auth_required}`), SSH singleton with auto port mapping (app-type shape with `fixedInternalPort: 22` + `autoPortMapping` 22000–22999, start allocates external port + writes store entry with appType='ssh'/instanceId='ssh', second start 409, stop/start reuses the same external port, stop does not remove the mapping) |
| `environments.spec.ts` | 41 | Full CRUD, all 5 network modes, field validation, partial update, timestamps, dockerEnabled, includePackageManagerDomains, list field completeness, networkMode change (full→custom), non-existent environmentId, name type validation (number/null/boolean), update with same name, delete+re-fetch, list sorting, cpuLimit zero, all fields populated, empty name rejection, negative cpuLimit, multi-line env vars, partial update preserves unchanged fields, deleted environment filtered from list |
| `port-mappings.spec.ts` | 29 | CRUD, response fields, validation (external + internal ports: 0, 65536, NaN, float, string, negative -1), duplicate detection, mapper status invariant, stopped worker rejection, mapper status counts after operations |
| `domain-mappings.spec.ts` | 75 | Status, list, CRUD (HTTPS/HTTP/TCP), validation (protocol, subdomain, port, baseDomain, worker), response fields, basicAuth CRUD, basicAuth validation (username-only, password-only), subdomain edge cases (leading/trailing hyphens, underscores, consecutive dots, single-char, numeric, multi-level, 64-char), port edge cases (0, 65536, negative, float, min/max valid, string coercion), protocol conflict detection (duplicate, HTTP+HTTPS allowed, HTTPS+TCP conflict, HTTP+TCP allowed), stopped worker rejection, path validation (leading slash, invalid chars, TCP rejection, root normalization, trailing slash strip, valid path, different paths on same domain, duplicate path+protocol, default empty), mapper status fields (totalMappings, baseDomains, dashboardUrl, baseDomainConfigs with challengeType), wildcard routing (default false, HTTP/HTTPS/TCP wildcards, bare-domain wildcard, HTTP-01 ACME rejection, non-strict truthy coercion, wildcard field on list, duplicate detection with wildcard, mixing wildcard/non-wildcard on same key, coexistence with deeper explicit subdomain), multi-base-domain routing (same subdomain on two different base domains) |
| `domain-mappings-batch.spec.ts` | 23 | Batch domain mapping creation, batch path support (create with path, TCP path rejection, default empty path) |
| `traefik-integration.spec.ts` | 34 | HTTPS routing (traffic via subdomain, TLS certificate), HTTP routing, BasicAuth (401 without credentials, 200 with credentials), Traefik lifecycle (container existence, mapping count updates, list verification), multi-domain support (baseDomains list, same subdomain on different domains), dashboard subdomain URL, wildcard routing (HTTPS + HTTP wildcard matches a child subdomain, exact host mapping beats wildcard priority, TCP wildcard terminates TLS on child SNI with wildcard cert, TCP wildcard stored mapping round-trip) |
| `archived-workers.spec.ts` | 15 | Archive/unarchive/delete flow, error handling, response fields (name/createdAt/archivedAt/displayName), unarchive returns new id, unarchive preserves displayName, unarchive and verify running, double archive error, image/environmentId fields, port mappings survive archive and unarchive (keyed by `containerName`), port mappings removed on permanent delete of archived worker |
| `workspace.spec.ts` | 9 | Upload (single/multi/subdirectory/empty), path traversal (basic + encoded), non-existent container, download |
| `service-status.spec.ts` | 8 | Desktop/editor status, non-existent container handling, response field validation, stopped container returns not running |
| `capabilities.spec.ts` | 24 | Capabilities CRUD, built-in capabilities, validation |
| `instructions.spec.ts` | 27 | Instruction entry CRUD, built-in entries, validation |
| `init-scripts.spec.ts` | 25 | Init script CRUD, built-in scripts, validation |
| `settings.spec.ts` | 11 | Settings endpoint, categorized sections — verifies the legacy `agent-auth` section is gone and `git-providers` reports clone domains only (no per-user tokens) |
| `account-env-vars.spec.ts` | 15 | Per-user env vars: GET/PUT auth gating, fresh-user defaults (now including sshPublicKey=''), well-known field upsert + partial PUT, customEnvVars round-trip, validation (lowercase / digit-prefixed / reserved / duplicate keys), per-user isolation, admin cannot see another user's values via the endpoint, sshPublicKey round-trip, sshPublicKey partial update, sshPublicKey per-user isolation |
| `account-credentials.spec.ts` | 5 | Per-user agent OAuth credential file listing + reset: auth gating, 3-entry shape for a fresh user, idempotent DELETE, unknown agent id rejection, independent listings per user |
| `user-scoped-worker-env.spec.ts` | 5 | End-to-end propagation: GITHUB_TOKEN, ANTHROPIC_API_KEY, and arbitrary custom env vars from one user's account flow into that user's workers via printenv; user A's worker shows A's token while B's shows B's; an Environment's envVars override the per-user value |
| `selfsigned-certs.spec.ts` | 10 | Self-signed CA certificate operations |
| `agent-api-domains.spec.ts` | 5 | Agent API domain allowlist |
| `git-providers.spec.ts` | 2 | Provider list, GitHub provider fields |
| `app-types.spec.ts` | 4 | Type list, chromium/socks5 types, port defs |
| `package-manager-domains.spec.ts` | 4 | Domain list, npm/pypi, valid domain format |
| `orchestrator-env-vars.spec.ts` | 4 | Env var list, fields, presence of orchestrator-wide keys (BASE_DOMAINS), explicit absence of per-user secrets (GITHUB_TOKEN / *_API_KEY) |
| `github.spec.ts` | 14 | Repos list, username, orgs, repo field validation, branches, branch field validation, create repo validation (missing owner/name, empty owner/name, no token), response shape validation, non-existent repo branches |
| `updates.spec.ts` | 11 | Update status, manual check trigger, apply rejection, response structure (3 image keys — orchestrator/worker/traefik, no mapper), check consistency |
| `traefik-unified.spec.ts` | 8 | Merged-mapper regression tests: `/api/log-sources` never returns `mapper`; `/api/updates` has no `mapper` key; `UpdatableImage` enum is 3 values; port mapping create/delete works while Traefik is up for domain mappings; port + domain mapping can coexist on the same worker; settings expose no `MAPPER_IMAGE` |
| `usage.spec.ts` | 7 | Per-user usage: GET/POST require auth (401 unauth), refresh populates 3 agents for the caller, refresh-then-get returns the same list, agent shape after refresh, per-user isolation (user B's OAuth token doesn't show up in user A's status) |
| `logs.spec.ts` | 28 | Log query response shape, entry fields, valid levels/sources, source/level/multi-level/search filtering, limit control/default/max clamping, newest-first ordering, ISO timestamps, combined filters, log-sources endpoint, container messages have no leading Docker timestamp (regression for the TTY \r split bug), orchestrator self-stdout captured with sourceId, until is exclusive (boundary entry not duplicated), backwards pagination via until walks contiguously without skipping, hasMore reports remaining matches, clear logs (serialized), clear idempotency |
| `terminal-exec.spec.ts` | 14 | WebSocket connect, initial output, echo command, pwd /workspace, HOME /home/agent, exit codes, named tmux window, resize, concurrent window isolation, multiline output, whoami agent user, non-existent container, ws-* tmux session cleanup on disconnect, multiple connections cleanup |
| `agent-prompting.spec.ts` | 6 | Agent CLI start + prompt response for Claude, Codex, Gemini (2 tests each, skipped without credentials) |
| `agent-data-persistence.spec.ts` | 22 | Agent config symlinks, config file contents, MCP servers (playwright + chrome-devtools) for Claude/Codex/Gemini, persistence across restart/rebuild/archive, no-overwrite on restart/rebuild |
| `git-identity.spec.ts` | 10 | Per-user git config (user.name/email from auth profile), WORKER env var contains gitName/gitEmail, no git wrapper at /usr/local/bin/git, persistence across rebuild, persistence across archive/unarchive, ContainerInfo includes gitName/gitEmail |
| `mcp-servers-loaded.spec.ts` | 6 | MCP server verification: Claude config keys + commands via jq, Codex `mcp list` output + enabled status, Gemini config keys + commands via jq |

### UI Tests (~552 tests, 39 files)

| File | Tests | Coverage |
|------|-------|----------|
| `login.spec.ts` | 4 | Login page renders with email/password fields + passkey button, wrong credentials show error, correct credentials redirect to dashboard, unauthenticated `/` redirects to `/login` (uses fresh storageState) |
| `passkey-management.spec.ts` | 5 | Register passkey via account modal, sign in with registered passkey, remove password after passkey, cannot remove last passkey, set new password after going passwordless. Uses CDP virtual WebAuthn authenticator (`tests/helpers/webauthn.ts`). |
| `route-guard.spec.ts` | 6 | Unauth user on `/` → `/login`, unauth user on `/login` stays, unauth user on `/setup` (when complete) → `/login`, `/api/setup/status` public, signed-in user visiting `/login` redirected to `/`, signed-in user on `/` loads dashboard |
| `users-modal.spec.ts` | 6 | Admin opens Users modal from System tab, create user via modal, promote + demote user, delete user, reset password, regular user does not see System tab |
| `account-modal.spec.ts` | 5 | Opens from sidebar footer, updates name (persists after reload), updates email (new email can sign in), changes password (new password can sign in), Close button dismisses modal |
| `account-modal-env-vars.spec.ts` | 6 | API keys / Custom env vars / SSH Access / Agent OAuth credentials sections render; GitHub token saves and persists across modal close+reopen; custom env var add+save+reload round-trip; invalid custom key surfaces an inline error; fresh user sees all 3 agents as Not logged in; SSH public key textarea save+reload round-trip |
| `dashboard.spec.ts` | 11 | Page load, title, buttons, sections, images, sidebar labels |
| `sidebar.spec.ts` | 27 | Collapse/expand, section toggles, theme buttons, resize, panel states, icon-only action buttons, single button row layout, compact card design, Capabilities/Instructions/Init Scripts row stacks vertically on narrow sidebar, tab bar horizontal scroll + overflow dropdown (20% visibility threshold, live updates on scroll, hidden when all tabs fit) |
| `create-worker-modal.spec.ts` | 31 | Open/close, form fields, name input, add repo/mount, environment dropdown, init preset dropdown, Create action, dropdown populates newly created environments, selecting a preset populates init-script textarea |
| `cross-modal-navigation.spec.ts` | 6 | Manage button navigation between modals |
| `container-card.spec.ts` | 15 | Name, status, buttons, icons, stop/restart/archive, Restart hidden when running, archive action hides card after confirmation, icon-only action buttons, compact card design |
| `rebuild.spec.ts` | 6 | Rebuild button visibility (running + stopped), confirm dialog dismiss cancels, rebuild state transition, display name preserved, new container ID after rebuild |
| `container-detail-modal.spec.ts` | 43 | Modal content, Worker section (Container/ID/Image/ImageID/Created), Configuration section (Environment/CPU/Memory/Docker), Network (Mode/Allowed Domains/Package Managers), Repositories, Mounts, Init Script, Exposed Worker APIs (badges), Capabilities (badges), Instructions (badges), Env Vars, Setup Script, status badge color, section order, close (Escape + overlay), custom environment name, snapshotted config |
| `environments-modal.spec.ts` | 24 | Open/close, pre-created env, create button, form fields (network, Docker, resources), Setup Script, Init Script, Create button, create-via-form flow, custom env Edit/Delete buttons, edit existing environment, network mode dropdown options |
| `environment-editor-network.spec.ts` | 11 | Network mode selector, custom domains, package manager toggle |
| `capabilities-modal.spec.ts` | 10 | Capabilities modal list, view built-in, create/edit/delete custom |
| `capabilities-modal-crud.spec.ts` | 7 | Capabilities CRUD operations via UI |
| `instructions-modal.spec.ts` | 8 | Instructions modal list, view built-in, create/edit/delete |
| `instructions-modal-crud.spec.ts` | 7 | Instructions CRUD operations via UI |
| `init-scripts-modal.spec.ts` | 9 | Init scripts modal list, view built-in, create/edit/delete |
| `init-scripts-crud.spec.ts` | 8 | Init scripts CRUD operations via UI |
| `init-preset-selector.spec.ts` | 6 | Default None, textarea, Custom/None sync |
| `settings-modal.spec.ts` | 10 | Settings modal content, sections, expand/collapse |
| `port-mappings-panel.spec.ts` | 13 | Section, button, API-created mappings, type labels (local + ext), delete button, form open/close, form fields (type selector, worker dropdown, port inputs), delete interaction, create-via-UI form submission flow |
| `domain-mappings-panel.spec.ts` | 48 | Status API, section visibility, form open/close, protocol selector, basic auth checkbox, TCP protocol hides auth, auth checkbox shows username/password inputs, base domain display, API-created mapping display, protocol badge, path input visibility, TCP hides path, path display in mapping list, wildcard checkbox visibility and enabled state, wildcard live match preview, wildcard mapping list display (`*.host` prefix + `wildcard` badge), wildcard checkbox remains visible/enabled when TCP is selected, TCP wildcard mapping list display (tcp + wildcard badges), TCP form shows explanatory hint in place of Basic auth |
| `domain-mappings-panel-advanced.spec.ts` | 27 | Advanced domain mapping panel interactions, TCP-to-HTTP restores path input |
| `selfsigned-ca-cert.spec.ts` | 8 | Self-signed CA certificate download UI |
| `service-panes.spec.ts` | 12 | Desktop and editor service panes |
| `apps-pane.spec.ts` | 9 | Apps pane for container, plus VS Code Tunnel and SSH singleton app types render with `Start` buttons and "Not running" empty state |
| `workspace-upload.spec.ts` | 8 | Upload button, modal, drop zone, close |
| `terminal-pane.spec.ts` | 9 | Terminal open, tmux tabs, xterm rows, create button, new tab creation, non-default tab has close button, main tab no close button, clicking Terminal twice opens two independent terminal tabs for the same worker and closing one leaves the other intact, keyboard typing produces WebSocket output |
| `tmux-tabs.spec.ts` | 9 | Tmux tab bar interactions |
| `split-pane.spec.ts` | 3 | Placeholder, terminal pane, tab bar |
| `theme-toggle.spec.ts` | 29 | Dark default, light switch, persistence, all modes |
| `ui-state-persistence.spec.ts` | 25 | UI state persistence across reloads, viewport clamp, drag-to-collapse |
| `usage-panel.spec.ts` | 24 | Usage panel display, progress bars, auth badges |
| `update-notification.spec.ts` | 24 | Images section, image names, toggle, update status |
| `archived-workers.spec.ts` | 10 | Archived section, collapsible, UI archive, worker card (name, Unarchive, Delete buttons), Unarchive action flow, Delete action flow, archived section count badge, archived-date text, multi-archived visibility |
| `log-pane.spec.ts` | 17 | Logs button visibility, open log pane, filter bar, source/level filter buttons, search input, status bar, entries/empty state, entry structure, tab bar, clicking Logs again opens a second independent tab, closing one tab leaves the sibling intact, entry count, source filter toggle, localStorage persistence, scroll-to-top triggers loadMore and prepends older entries, tab close |

## Design Decisions

### Parallel safety
- Tests use unique display names with `Date.now()` to avoid collisions
- No global cleanup in `afterEach` — each test only deletes resources it created (global teardown of all workers/mappings/etc. would race with parallel tests)
- Serial test groups (`test.describe.serial`) for stateful container flows

### Selectors
- `.rounded-lg` + `.filter({ hasText })` for container cards
- `getByText('Text', { exact: true })` to avoid case-insensitive substring matches
- `h1:has-text("Agentor")` instead of `text=Agentor` (avoids matching container names)
- Button counting instead of `button svg`/`button img` (Nuxt UI renders icons variably)

### Timeouts
- Container creation: 90s (workers take time to start Docker containers)
- Running status: 60s (waiting for container entrypoint)
- UI assertions: 5-15s default
- Global test timeout: 120s
- WebSocket connect: 10s
- Shell prompt after connect: 15s
- Simple command output: 10-30s
- Agent CLI readiness: 120s
- Agent LLM response: 120s
- Per-test (agent prompting): 300s

### Traefik integration tests
- Skipped automatically when `BASE_DOMAINS` is not configured (all tests use `test.skip(!mapperEnabled)`)
- Uses `playwrightRequest.newContext({ ignoreHTTPSErrors: true })` for HTTPS requests (Traefik default self-signed cert)
- Each test creates its own worker and domain mapping, cleans up in `finally`
- 3s delay after mapping creation for Traefik to pick up config changes
- Network-level failures (DNS resolution) accepted gracefully via `catch {}`

### Agent prompting tests
- Skipped automatically when agent credentials are not configured (checks `/api/orchestrator-env-vars` for API keys and `.cred/` files)
- Each agent gets its own worker with the agent's init script preset
- Serial tests: first test verifies CLI starts, second sends a prompt and checks response
- 300s per-test timeout (agent startup + LLM inference can be slow)
- Uses `TerminalWsClient` WebSocket helper for terminal interaction

### Terminal WebSocket tests
- Uses Node.js native `WebSocket` (Node 22+) via `TerminalWsClient` helper
- ANSI escape codes stripped for clean pattern matching
- Serial tests sharing one worker container for efficiency
- Named tmux windows created/cleaned up per test

## Adding New Tests

1. API test: create `tests/api/<feature>.spec.ts`, import `ApiClient`
2. UI test: create `tests/ui/<feature>.spec.ts`, import helpers
3. Tests needing a container: use `createWorker()` in `beforeAll`/`beforeEach` with `cleanupWorker()` in matching teardown
4. Serial tests: use `test.describe.serial` when tests share state (e.g., stop then restart a container)
5. **Update this file**: add the new file to the appropriate table above with test count and coverage description
6. **Update FEATURES.md**: if testing a new feature, add it to the feature inventory first

## Updating Test Counts

Run this to get current per-file counts:
```bash
cd tests
for f in api/*.spec.ts ui/*.spec.ts; do
  count=$(grep -cE "^\s*test(\.(skip|only))?\(" "$f" 2>/dev/null || echo 0)
  echo "$f: $count"
done
```
