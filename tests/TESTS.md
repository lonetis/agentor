# Agentor Test Suite

Comprehensive end-to-end test suite for the Agentor platform using Playwright and TypeScript. Covers all API endpoints and UI interactions.

## Overview

- **~964 tests** across 69 test files (~487 API + ~477 UI)
- **API tests**: headless, no browser needed, fast execution
- **UI tests**: Desktop Chrome (1920x1080), real browser interactions
- **Terminal tests**: WebSocket-based command execution and agent CLI prompting
- Parallel execution with 4 workers (configurable)
- All tests independent and self-cleaning

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
  api/                     # API endpoint tests (~487 tests across 32 files)
  ui/                      # UI interaction tests (~477 tests across 37 files)
```

## Test Categories

### API Tests (~487 tests, 32 files)

| File | Tests | Coverage |
|------|-------|----------|
| `health.spec.ts` | 4 | Health check endpoint, container count validation, exact status 'ok', no sensitive info exposure |
| `containers.spec.ts` | 47 | CRUD, validation, field completeness, name format, stop/restart/archive/delete on non-existent, logs (running/stopped/non-empty/non-numeric tail graceful default), memoryLimit, initScript, environmentId, dockerEnabled, displayName persistence, state transitions (double-stop, restart running, archive stopped), list exclusion, response fields, snapshotted environment data fields, no labels |
| `containers-edge-cases.spec.ts` | 10 | Edge case container operations |
| `rebuild.spec.ts` | 12 | Rebuild running/stopped container, preserves metadata (name, displayName, createdAt, initScript, environment config), returns new container ID, removes old ID from list, cleans up port mappings, non-existent container error, response field completeness |
| `tmux-panes.spec.ts` | 29 | Window CRUD, name validation, main window protection, duplicates, rename verify, whitespace name, non-existent container, auto-generated name format, rename/delete idempotency, main always present, 50-char name, rename main behavior, missing newName in body |
| `apps.spec.ts` | 14 | App lifecycle (socks5 start/stop, chromium), error handling (invalid type, non-existent container/instance), response fields (id/port on start, instance fields on list, ok on stop) |
| `environments.spec.ts` | 38 | Full CRUD, all 5 network modes, field validation, partial update, timestamps, dockerEnabled, includePackageManagerDomains, list field completeness, networkMode change (full→custom), non-existent environmentId, name type validation (number/null/boolean), update with same name, delete+re-fetch, list sorting, cpuLimit zero, all fields populated, empty name rejection, negative cpuLimit |
| `environments-advanced.spec.ts` | 7 | Advanced environment operations |
| `port-mappings.spec.ts` | 29 | CRUD, response fields, validation (external + internal ports: 0, 65536, NaN, float, string, negative -1), duplicate detection, mapper status invariant, stopped worker rejection, mapper status counts after operations |
| `domain-mappings.spec.ts` | 43 | Status, list, CRUD (HTTPS/HTTP/TCP), validation (protocol, subdomain, port, baseDomain, worker), response fields, basicAuth CRUD, basicAuth validation (username-only, password-only), subdomain edge cases (leading/trailing hyphens, underscores, consecutive dots, single-char, numeric, multi-level, 64-char), port edge cases (0, 65536, negative, float, min/max valid, string coercion), protocol conflict detection (duplicate, HTTP+HTTPS allowed, HTTPS+TCP conflict, HTTP+TCP allowed), stopped worker rejection, mapper status fields (totalMappings, baseDomains, dashboardUrl) |
| `domain-mappings-advanced.spec.ts` | 9 | Advanced domain mapping operations |
| `domain-mappings-batch.spec.ts` | 20 | Batch domain mapping creation |
| `traefik-integration.spec.ts` | 23 | HTTPS routing (traffic via subdomain, TLS certificate), HTTP routing, BasicAuth (401 without credentials, 200 with credentials), Traefik lifecycle (container existence, mapping count updates, list verification), multi-domain support (baseDomains list, same subdomain on different domains), dashboard subdomain URL |
| `archived-workers.spec.ts` | 13 | Archive/unarchive/delete flow, error handling, response fields (name/createdAt/archivedAt/displayName), unarchive returns new id, unarchive preserves displayName, unarchive and verify running, double archive error, image/environmentId fields |
| `workspace.spec.ts` | 9 | Upload (single/multi/subdirectory/empty), path traversal (basic + encoded), non-existent container, download |
| `service-status.spec.ts` | 8 | Desktop/editor status, non-existent container handling, response field validation, stopped container returns not running |
| `skills.spec.ts` | 24 | Skills CRUD, built-in skills, validation |
| `agents-md.spec.ts` | 27 | AGENTS.md entry CRUD, built-in entries, validation |
| `init-scripts.spec.ts` | 25 | Init script CRUD, built-in scripts, validation |
| `settings.spec.ts` | 11 | Settings endpoint, categorized sections |
| `credentials.spec.ts` | 6 | Credential file status per agent |
| `selfsigned-certs.spec.ts` | 10 | Self-signed CA certificate operations |
| `agent-api-domains.spec.ts` | 5 | Agent API domain allowlist |
| `git-providers.spec.ts` | 2 | Provider list, GitHub provider fields |
| `app-types.spec.ts` | 4 | Type list, chromium/socks5 types, port defs |
| `package-manager-domains.spec.ts` | 4 | Domain list, npm/pypi, valid domain format |
| `orchestrator-env-vars.spec.ts` | 4 | Env var list, fields, token/credential entries |
| `github.spec.ts` | 14 | Repos list, username, orgs, repo field validation, branches, branch field validation, create repo validation (missing owner/name, empty owner/name, no token), response shape validation, non-existent repo branches |
| `updates.spec.ts` | 11 | Update status, manual check trigger, apply rejection, response structure (image keys), check consistency |
| `usage.spec.ts` | 7 | Usage endpoint, agent usage status |
| `terminal-exec.spec.ts` | 12 | WebSocket connect, initial output, echo command, pwd /workspace, HOME /home/agent, exit codes, named tmux window, resize, concurrent window isolation, multiline output, whoami agent user, non-existent container |
| `agent-prompting.spec.ts` | 6 | Agent CLI start + prompt response for Claude, Codex, Gemini (2 tests each, skipped without credentials) |

### UI Tests (~477 tests, 37 files)

| File | Tests | Coverage |
|------|-------|----------|
| `dashboard.spec.ts` | 11 | Page load, title, buttons, sections, images, sidebar labels |
| `sidebar.spec.ts` | 19 | Collapse/expand, section toggles, theme buttons, resize, panel states, icon-only action buttons, single button row layout, compact card design |
| `create-worker-modal.spec.ts` | 29 | Open/close, form fields, name input, add repo/mount, environment dropdown, init preset dropdown, Create action |
| `create-worker-modal-advanced.spec.ts` | 8 | Advanced modal interactions |
| `cross-modal-navigation.spec.ts` | 6 | Manage button navigation between modals |
| `container-card.spec.ts` | 14 | Name, status, buttons, icons, stop/restart/archive, Restart hidden when running |
| `container-card-advanced.spec.ts` | 7 | Advanced container card interactions, icon-only action buttons, single button row layout, compact card design |
| `rebuild.spec.ts` | 6 | Rebuild button visibility (running + stopped), confirm dialog dismiss cancels, rebuild state transition, display name preserved, new container ID after rebuild |
| `container-detail-modal.spec.ts` | 43 | Modal content, Worker section (Container/ID/Image/ImageID/Created), Configuration section (Environment/CPU/Memory/Docker), Network (Mode/Allowed Domains/Package Managers), Repositories, Mounts, Init Script, Exposed Worker APIs (badges), Skills (badges), AGENTS.md (badges), Env Vars, Setup Script, status badge color, section order, close (Escape + overlay), custom environment name, snapshotted config |
| `environments-modal.spec.ts` | 20 | Open/close, pre-created env, create button, form fields (network, Docker, resources), Setup Script, Init Script, Create button |
| `environments-modal-advanced.spec.ts` | 5 | Advanced environment modal interactions |
| `environment-editor-network.spec.ts` | 11 | Network mode selector, custom domains, package manager toggle |
| `skills-modal.spec.ts` | 10 | Skills modal list, view built-in, create/edit/delete custom |
| `skills-modal-crud.spec.ts` | 7 | Skills CRUD operations via UI |
| `agents-md-modal.spec.ts` | 8 | AGENTS.md modal list, view built-in, create/edit/delete |
| `agents-md-crud.spec.ts` | 7 | AGENTS.md CRUD operations via UI |
| `init-scripts-modal.spec.ts` | 9 | Init scripts modal list, view built-in, create/edit/delete |
| `init-scripts-crud.spec.ts` | 8 | Init scripts CRUD operations via UI |
| `init-preset-selector.spec.ts` | 6 | Default None, textarea, Custom/None sync |
| `settings-modal.spec.ts` | 10 | Settings modal content, sections, expand/collapse |
| `port-mappings-panel.spec.ts` | 13 | Section, button, empty state, API-created mappings, type labels (local + ext), delete button, form open/close, form fields (type selector, worker dropdown, port inputs), delete interaction |
| `port-mappings-create.spec.ts` | 3 | Port mapping creation form |
| `domain-mappings-panel.spec.ts` | 25 | Status API, section visibility, form open/close, protocol selector, basic auth checkbox, TCP protocol hides auth, auth checkbox shows username/password inputs, base domain display, API-created mapping display, protocol badge, empty state message |
| `domain-mappings-panel-advanced.spec.ts` | 26 | Advanced domain mapping panel interactions |
| `selfsigned-ca-cert.spec.ts` | 8 | Self-signed CA certificate download UI |
| `service-panes.spec.ts` | 12 | Desktop and editor service panes |
| `apps-pane.spec.ts` | 8 | Apps pane for container |
| `workspace-upload.spec.ts` | 8 | Upload button, modal, drop zone, close |
| `terminal-pane.spec.ts` | 8 | Terminal open, tmux tabs, xterm rows, create button, new tab creation, non-default tab has close button, main tab no close button, keyboard typing produces WebSocket output |
| `tmux-tabs.spec.ts` | 9 | Tmux tab bar interactions |
| `split-pane.spec.ts` | 3 | Placeholder, terminal pane, tab bar |
| `theme-toggle.spec.ts` | 29 | Dark default, light switch, persistence, all modes |
| `ui-state-persistence.spec.ts` | 23 | UI state persistence across reloads |
| `usage-panel.spec.ts` | 24 | Usage panel display, progress bars, auth badges |
| `update-notification.spec.ts` | 24 | Images section, image names, toggle, update status |
| `archived-workers.spec.ts` | 6 | Archived section, collapsible, UI archive, worker card (name, Unarchive, Delete buttons) |
| `archived-workers-actions.spec.ts` | 4 | Archived worker unarchive/delete actions |

## Design Decisions

### Parallel safety
- Tests use unique display names with `Date.now()` to avoid collisions
- No `cleanupAllWorkers` in `afterEach` (causes race conditions)
- Each test cleans up only resources it created
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
