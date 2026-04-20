# Testing

## Overview

- **~1000 tests** across 69 test files (~508 API + ~492 UI)
- **API tests**: headless, no browser needed, fast execution
- **UI tests**: Desktop Chrome (1920x1080), real browser interactions
- **Terminal tests**: WebSocket-based command execution and agent CLI prompting
- Parallel execution with 4 workers (configurable)
- All tests independent and self-cleaning

Unit tests (vitest) are planned but not yet implemented.

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

# Specific test file
npx playwright test api/health.spec.ts

# View HTML report after run
npm run test:report
```

## Default Failure Artifacts

Failed tests automatically produce all debug artifacts — no flags needed:

| Artifact | Default | Kept for |
|----------|---------|----------|
| Traces | `retain-on-failure` | Failed tests (DOM snapshots, network, console, actions) |
| Video | `retain-on-failure` | Failed tests (full browser session recording) |
| Screenshots | `only-on-failure` | Failed tests (final page state) |
| Retries | 1 locally, 2 in CI | All tests get 1 automatic retry |

All artifacts are saved in `test-results/<test-folder>/` and linked from the HTML report (`npm run test:report`).

## Debugging & Dev Output

### Viewing Failure Artifacts

After a test fails, open the HTML report to inspect all captured artifacts:

```bash
npm run test:report
```

Click a failed test to see its traces, video, and screenshots inline. Or open a trace file directly:

```bash
npx playwright show-trace test-results/<test-folder>/trace.zip
```

### Recording Everything (Including Passing Tests)

By default, artifacts are only kept for failures. To capture everything:

```bash
# Traces for all tests
npm run test:trace

# Video for all tests
npx playwright test --video on

# All artifacts for all tests
npx playwright test --trace on --video on --screenshot on
```

### Headed Mode & Slow Motion

Watch tests run in a visible browser, optionally slowed down:

```bash
# Headed (visible browser)
npm run test:headed

# Debug mode (headed + slow motion 200ms + single worker)
npm run test:debug

# Custom slow motion
npx playwright test --project=ui --headed --slowmo 500

# Single test, headed with slow motion
npx playwright test ui/dashboard.spec.ts --headed --slowmo 300
```

### Playwright Inspector (Step-Through Debugging)

Pause execution and step through actions interactively:

```bash
# Open inspector for a specific test
npx playwright test ui/dashboard.spec.ts --debug

# Or add page.pause() in test code for a breakpoint
```

The inspector opens a browser and a control panel where you can step through each action, inspect selectors, and see the page state.

### Useful CLI Flags

```bash
# Run only tests matching a regex
npx playwright test -g "should create worker"

# Run with verbose output (each test name + status)
npx playwright test --reporter=list

# Run single worker (no parallelism, easier to debug)
npx playwright test --workers=1

# Retry failed tests N times
npx playwright test --retries=2

# Combine multiple flags for a full debug session
npx playwright test ui/sidebar.spec.ts --headed --slowmo 200 --trace on --video on --workers=1
```

### Output Locations

All artifacts are written to `test-results/` (gitignored):

| Artifact | Flag | Location |
|----------|------|----------|
| HTML report | always | `playwright-report/` |
| Traces | `--trace` | `test-results/<test>/trace.zip` |
| Videos | `--video` | `test-results/<test>/*.webm` |
| Screenshots | `--screenshot` | `test-results/<test>/*.png` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Orchestrator URL |
| `CI` | - | Set to reduce workers to 1 |

## Typecheck

```bash
cd orchestrator && npx nuxi prepare && npx vue-tsc --noEmit -p .nuxt/tsconfig.json
```

## Writing New Tests

### API Tests

1. Create `tests/api/<feature>.spec.ts`
2. Import `ApiClient` from `../helpers/api-client`
3. Use `createWorker()` / `cleanupWorker()` for tests that need a container
4. Return `{ status, body }` tuples and assert on both

### UI Tests

1. Create `tests/ui/<feature>.spec.ts`
2. Import helpers from `../helpers/ui-helpers`
3. Use Playwright's `page` fixture for browser interactions
4. Target elements using `.rounded-lg` + `.filter({ hasText })` for container cards, `getByText('Text', { exact: true })` to avoid substring matches

### Tests Needing a Container

Use `createWorker()` in `beforeAll`/`beforeEach` with `cleanupWorker()` in matching teardown. Worker creation has a 90s timeout.

### Serial Tests

Use `test.describe.serial` when tests share state (e.g., stop then restart a container).

## Conventions

### Parallel Safety
- Tests use unique display names with `Date.now()` to avoid collisions
- No `cleanupAllWorkers` in `afterEach` (causes race conditions in parallel runs)
- Each test cleans up only resources it created

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

### Conditional Skips
- **Traefik integration tests**: Skipped when `BASE_DOMAINS` is not configured
- **Agent prompting tests**: Skipped when the admin user has no agent credentials configured. The helper checks `/api/account/env-vars` for the admin's API keys and `/api/account/agent-credentials` for OAuth file status; if none are set the test is skipped.
- **Domain mappings UI**: Some tests skipped when `BASE_DOMAINS` is not set

### Terminal WebSocket Tests
- Uses Node.js native `WebSocket` (Node 22+) via `TerminalWsClient` helper
- ANSI escape codes stripped for clean pattern matching
- Serial tests sharing one worker container for efficiency
- Named tmux windows created/cleaned up per test

## Test Helpers

### `api-client.ts`
Typed wrapper for all API endpoints. Every method returns `{ status, body }` tuples. Covers containers, tmux, apps, port/domain mappings, environments, capabilities, instructions, init scripts, archived workers, updates, usage, github, settings, and more.

### `worker-lifecycle.ts`
Container create/cleanup helpers with 90s timeout. `createWorker(api, options?)` creates a container and waits for it to be running. `cleanupWorker(api, id)` safely removes a container (idempotent). Also provides cleanup helpers for port mappings, domain mappings, environments, capabilities, instructions, and init scripts.

### `terminal-ws.ts`
WebSocket terminal client with ANSI stripping for pattern matching. `TerminalWsClient` connects to the terminal WebSocket, sends commands, and waits for output patterns. Also provides credential detection for agent prompting tests.

### `ui-helpers.ts`
Page navigation and interaction helpers for Playwright UI tests.

## Maintaining FEATURES.md

`tests/FEATURES.md` is the canonical feature inventory — every user-facing feature must be listed there. It drives test coverage decisions.

### When to Update
- **Adding a new feature**: Add a new section or subsection to FEATURES.md describing all user-facing behaviors
- **Modifying an existing feature**: Update the relevant section to reflect changed behavior
- **Removing a feature**: Remove the section from FEATURES.md

### Structure
- Organized by UI area / feature category (numbered sections)
- Each feature lists all observable behaviors, states, and interactions
- API endpoints listed with their methods, paths, and validation rules
- Sections separated by `---` horizontal rules

### Guidelines
- Be exhaustive: list every button, state, validation, edge case
- Use imperative descriptions: "Page loads with..." not "The page should load with..."
- Include conditional behaviors (e.g., "only shown when X is configured")
- Document both happy paths and error states

## Maintaining TESTS.md

`tests/TESTS.md` documents the test suite — counts, structure, and design decisions.

### When to Update
- **Adding new test files**: Add the file to the appropriate table (API or UI) with test count and coverage description
- **Adding tests to existing files**: Update the test count for that file
- **Adding new helpers**: Update the Test Structure and helper sections
- **Changing test patterns**: Update the Design Decisions section

### Test Count Accuracy
Run this to get current counts per file:
```bash
cd tests
for f in api/*.spec.ts ui/*.spec.ts; do
  count=$(grep -cE "^\s*test(\.(skip|only))?\(" "$f" 2>/dev/null || echo 0)
  echo "$f: $count"
done
```

Update the overview totals (~N tests), per-category totals, and per-file counts in the tables.
