# Agentor Test Suite

Comprehensive end-to-end test suite for the Agentor platform using Playwright and TypeScript. Covers all API endpoints and UI interactions.

## Overview

- **~431 tests** across 35 test files (~298 API + ~133 UI)
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

# Specific test file
npx playwright test api/health.spec.ts

# View HTML report after run
npm run test:report
```

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
  api/                     # API endpoint tests (~298 tests, 11 Traefik skipped when BASE_DOMAINS not set)
    health.spec.ts
    containers.spec.ts
    tmux-panes.spec.ts
    apps.spec.ts
    environments.spec.ts
    port-mappings.spec.ts
    domain-mappings.spec.ts
    traefik-integration.spec.ts
    archived-workers.spec.ts
    workspace.spec.ts
    service-status.spec.ts
    init-presets.spec.ts
    git-providers.spec.ts
    app-types.spec.ts
    package-manager-domains.spec.ts
    orchestrator-env-vars.spec.ts
    github.spec.ts
    updates.spec.ts
    terminal-exec.spec.ts
    agent-prompting.spec.ts
  ui/                      # UI interaction tests (~133 tests)
    dashboard.spec.ts
    sidebar.spec.ts
    create-worker-modal.spec.ts
    container-card.spec.ts
    container-detail-modal.spec.ts
    environments-modal.spec.ts
    init-preset-selector.spec.ts
    port-mappings-panel.spec.ts
    domain-mappings-panel.spec.ts
    workspace-upload.spec.ts
    terminal-pane.spec.ts
    split-pane.spec.ts
    theme-toggle.spec.ts
    archived-workers.spec.ts
    update-notification.spec.ts
```

## Test Categories

### API Tests (~298 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `health.spec.ts` | 4 | Health check endpoint, container count validation, exact status 'ok', no sensitive info exposure |
| `containers.spec.ts` | 41 | CRUD, validation, field completeness, name format, stop/restart/archive/delete on non-existent, logs (running/stopped/non-empty/non-numeric tail graceful default), memoryLimit, initScript, environmentId, dockerEnabled, displayName persistence, state transitions (double-stop, restart running, archive stopped), list exclusion, response fields |
| `tmux-panes.spec.ts` | 29 | Window CRUD, name validation, main window protection, duplicates, rename verify, whitespace name, non-existent container, auto-generated name format, rename/delete idempotency, main always present, 50-char name, rename main behavior, missing newName in body |
| `apps.spec.ts` | 14 | App lifecycle (socks5 start/stop, chromium), error handling (invalid type, non-existent container/instance), response fields (id/port on start, instance fields on list, ok on stop) |
| `environments.spec.ts` | 38 | Full CRUD, all 5 network modes, field validation, partial update, timestamps, dockerEnabled, includePackageManagerDomains, list field completeness, networkMode change (full→custom), non-existent environmentId, name type validation (number/null/boolean), update with same name, delete+re-fetch, list sorting, cpuLimit zero, all fields populated, empty name rejection, negative cpuLimit |
| `port-mappings.spec.ts` | 29 | CRUD, response fields, validation (external + internal ports: 0, 65536, NaN, float, string, negative -1), duplicate detection, mapper status invariant, stopped worker rejection, mapper status counts after operations |
| `domain-mappings.spec.ts` | 43 | Status, list, CRUD (HTTPS/HTTP/TCP), validation (protocol, subdomain, port, baseDomain, worker), response fields, basicAuth CRUD, basicAuth validation (username-only, password-only), subdomain edge cases (leading/trailing hyphens, underscores, consecutive dots, single-char, numeric, multi-level, 64-char), port edge cases (0, 65536, negative, float, min/max valid, string coercion), protocol conflict detection (duplicate, HTTP+HTTPS allowed, HTTPS+TCP conflict, HTTP+TCP allowed), stopped worker rejection, mapper status fields (totalMappings, baseDomains, dashboardUrl) |
| `traefik-integration.spec.ts` | 11 | HTTPS routing (traffic via subdomain, TLS certificate), HTTP routing, BasicAuth (401 without credentials, 200 with credentials), Traefik lifecycle (container existence, mapping count updates, list verification), multi-domain support (baseDomains list, same subdomain on different domains), dashboard subdomain URL |
| `archived-workers.spec.ts` | 13 | Archive/unarchive/delete flow, error handling, response fields (name/createdAt/archivedAt/displayName), unarchive returns new id, unarchive preserves displayName, unarchive and verify running, double archive error, image/environmentId fields |
| `workspace.spec.ts` | 9 | Upload (single/multi/subdirectory/empty), path traversal (basic + encoded), non-existent container, download |
| `service-status.spec.ts` | 8 | Desktop/editor status, non-existent container handling, response field validation, stopped container returns not running |
| `init-presets.spec.ts` | 6 | Preset list, required fields, agent presets |
| `git-providers.spec.ts` | 2 | Provider list, GitHub provider fields |
| `app-types.spec.ts` | 4 | Type list, chromium/socks5 types, port defs |
| `package-manager-domains.spec.ts` | 4 | Domain list, npm/pypi, valid domain format |
| `orchestrator-env-vars.spec.ts` | 4 | Env var list, fields, token/credential entries |
| `github.spec.ts` | 14 | Repos list, username, orgs, repo field validation, branches, branch field validation, create repo validation (missing owner/name, empty owner/name, no token), response shape validation, non-existent repo branches |
| `updates.spec.ts` | 6 | Update status, manual check trigger, apply rejection, response structure (image keys), check consistency |
| `terminal-exec.spec.ts` | 12 | WebSocket connect, initial output, echo command, pwd /workspace, HOME /home/agent, exit codes, named tmux window, resize, concurrent window isolation, multiline output, whoami agent user, non-existent container |
| `agent-prompting.spec.ts` | 6 | Agent CLI start + prompt response for Claude, Codex, Gemini (2 tests each, skipped without credentials) |

### UI Tests (~133 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `dashboard.spec.ts` | 11 | Page load, title, buttons, sections, images, sidebar labels |
| `sidebar.spec.ts` | 6 | Collapse/expand, section toggles, theme buttons |
| `create-worker-modal.spec.ts` | 18 | Open/close, form fields, name input, add repo/mount, environment dropdown, init preset dropdown, Create action |
| `container-card.spec.ts` | 11 | Name, status, buttons, icons, stop/restart/archive, Restart hidden when running |
| `container-detail-modal.spec.ts` | 13 | Modal content, Docker labels, Configuration section, status, ID, close (Escape + overlay) |
| `environments-modal.spec.ts` | 11 | Open/close, pre-created env, create button, form fields (network, Docker, resources), Setup Script, Init Script, Create button |
| `init-preset-selector.spec.ts` | 6 | Default None, textarea, Custom/None sync |
| `port-mappings-panel.spec.ts` | 12 | Section, button, empty state, API-created mappings, type labels (local + ext), delete button, form open/close, form fields (type selector, worker dropdown, port inputs), delete interaction |
| `domain-mappings-panel.spec.ts` | 14 | Status API, section visibility, form open/close, protocol selector, basic auth checkbox, TCP protocol hides auth, auth checkbox shows username/password inputs, base domain display, API-created mapping display, protocol badge, empty state message (8 skipped if no BASE_DOMAINS) |
| `workspace-upload.spec.ts` | 8 | Upload button, modal, drop zone, close |
| `terminal-pane.spec.ts` | 8 | Terminal open, tmux tabs, xterm rows, create button, new tab creation, non-default tab has close button, main tab no close button, keyboard typing produces WebSocket output |
| `split-pane.spec.ts` | 3 | Placeholder, terminal pane, tab bar |
| `theme-toggle.spec.ts` | 3 | Dark default, light switch, persistence |
| `archived-workers.spec.ts` | 6 | Archived section, collapsible, UI archive, worker card (name, Unarchive, Delete buttons) |
| `update-notification.spec.ts` | 3 | Images section, image names, toggle |

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
