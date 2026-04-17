# Logging System

## Overview

Centralized logging system that collects logs from all platform containers (orchestrator, workers, traefik) into the orchestrator. Logs are persisted to disk with rotation and streamed live to the web dashboard via WebSocket.

## Architecture

```
Worker containers ─────┐
Traefik container ─────┤── dockerode container.logs({ follow }) ──→ LogCollector ──→ LogStore (NDJSON files)
Orchestrator (self) ───┘                                                         ──→ LogBroadcaster (WebSocket)
Orchestrator code ──→ Logger ──→ LogStore + LogBroadcaster

Browser (LogPane) ←── WebSocket /ws/logs ←── LogBroadcaster
Browser (LogPane) ←── REST GET /api/logs ←── LogStore
```

Four components:
- **Logger** (`logger.ts`): Replaces `console.log/warn/error` in the orchestrator for *intentional* logging. Buffers entries before `setReady()` during early startup. Writes directly to the log store — never to stdout — so it does not double-record alongside the LogCollector self-attach.
- **LogStore** (`log-store.ts`): NDJSON file storage with size-based rotation. Two log categories: `orchestrator.log` and `containers.log`.
- **LogBroadcaster** (`log-broadcaster.ts`): Manages WebSocket peers for live log streaming.
- **LogCollector** (`log-collector.ts`): Attaches to Docker containers via `container.logs({ follow: true })`. Handles both TTY (raw, `\r\n`-terminated) and non-TTY (8-byte-framed, demuxed into independent stdout/stderr buffers) streams. Parses Docker timestamps and detects log level heuristically. `attachSelf()` runs at the very top of the services plugin and pulls the orchestrator container's own stdout (Nuxt/Nitro/Vite output, `console.warn` outside `useLogger`, unhandled exceptions) into `orchestrator.log` with the orchestrator container name as `sourceId`.

## Log Entry Format

```typescript
interface LogEntry {
  timestamp: string;    // ISO 8601
  level: LogLevel;      // 'debug' | 'info' | 'warn' | 'error'
  source: LogSource;    // 'orchestrator' | 'worker' | 'traefik'
  sourceId?: string;    // Container name (for container logs)
  sourceName?: string;  // Display name (for worker containers)
  message: string;
}
```

## Storage

Logs are stored as NDJSON (one JSON entry per line) in `<DATA_DIR>/logs/`:

```
/data/logs/
├── orchestrator.log       ← orchestrator internal logs
├── orchestrator.1.log     ← rotated
├── containers.log         ← all container logs (workers, traefik)
└── containers.1.log       ← rotated
```

**Rotation**: When a log file exceeds `LOG_MAX_SIZE`, it's renamed to `.1.log`, shifting existing rotated files up. The oldest file (`.{LOG_MAX_FILES}.log`) is deleted. Default: 50MB max size, 5 rotated files per category.

## Container Log Collection

The LogCollector attaches to:
- The orchestrator's own container (via `attachSelf()`, identified by `os.hostname()`) — runs as the very first thing in the services plugin so framework stdout is captured from as early as possible. Source = `orchestrator`.
- All other containers carrying the `agentor.managed` label, on startup (`init()`) and when containers are created/restarted/rebuilt/unarchived. Source = `worker` or `traefik` depending on the label value.

It detaches when containers are stopped, removed, archived, or replaced (rebuild/unarchive detach the old container ID, attach the new one).

**Source detection**: The `agentor.managed` label value determines the source type:
- `true` → `worker`
- `traefik` → `traefik`

The orchestrator container has no `agentor.managed` label — it is found via `os.hostname()` in `attachSelf()`.

**Since filter**: `init()` and `attachSelf()` use `since: now` to avoid replaying historical lines on orchestrator restart (those lines are already on disk). Fresh attaches from `ContainerManager.create()/restart()/rebuild()/unarchive()` and `TraefikManager` skip the filter so the entire container history (which is at most milliseconds old) is captured.

**TTY vs non-TTY**: Worker containers use TTY mode (raw stream, `\r\n` line endings — split on `\r?\n` to avoid the trailing `\r` breaking the timestamp regex). Traefik runs non-TTY (8-byte-framed multiplex), demuxed via `docker.modem.demuxStream` into independent stdout/stderr handlers, each with its own line buffer so partial lines never leak across streams. The stderr handler force-tags entries as `error`.

**Worker background services**: `dockerd`, `code-server`, `vscode-tunnel`, `chromium`, and `microsocks` all mirror their stdout/stderr through `tee` (or `>(... >> /proc/1/fd/1)` from the docker-exec entry points) so their output reaches the container's stdout in addition to the in-container debug log file. Each line is prefixed with the service tag (e.g. `[dockerd]`, `[code-server]`, `[vscode-tunnel]`, `[chromium-<id>]`, `[socks5-<id>]`) so the centralized log can tell them apart from entrypoint output.

**Not captured by design**: tmux pane output inside workers (interactive shell / agent CLI output) is served over the terminal WebSocket, not as Docker logs.

**Level detection**: Log level is detected heuristically from message content:
- `[error]`, `error:` → error
- `[warn]`, `warning:` → warn
- `[debug]`, `debug:` → debug
- Default → info

## Web UI (LogPane)

The log pane opens via the "Logs" button in the System tab's Quick Links section. It renders as a split pane tab (type `'logs'`, ID `'__logs__'`).

**Features**:
- Live WebSocket streaming with auto-reconnect (3s)
- Filter by source (orchestrator, worker, traefik) — toggle buttons
- Filter by level (debug, info, warn, error) — toggle buttons
- Text search with 300ms debounce
- Auto-scroll to bottom (disables on manual scroll up, re-enables at bottom)
- Color-coded level badges: debug (gray), info (blue), warn (amber), error (red)
- Color-coded source badges: orchestrator (purple), worker (green), traefik (orange)
- Source ID display for container logs (display name or container name)
- Status bar: connection indicator + entry count
- Clear all logs button (with confirmation)
- Client-side buffer: max 5000 entries
- History fetch on mount (500 most recent entries via REST API)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/logs` | Query log entries with filters (sources, levels, search, since, until, limit) |
| `DELETE` | `/api/logs` | Clear all log files |
| `GET` | `/api/log-sources` | List known container log sources |
| `WS` | `/ws/logs` | Live log stream (read-only, JSON-encoded LogEntry per message) |

### Query Parameters for `GET /api/logs`

| Param | Type | Description |
|-------|------|-------------|
| `sources` | string | Comma-separated: `orchestrator,worker,traefik` |
| `sourceIds` | string | Comma-separated container names |
| `levels` | string | Comma-separated: `debug,info,warn,error` |
| `since` | string | ISO 8601 timestamp (entries after) |
| `until` | string | ISO 8601 timestamp (entries before) |
| `limit` | integer | Max entries (default 500, max 5000) |
| `search` | string | Substring search in message |

## Configuration

All via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum severity: `debug`, `info`, `warn`, `error` |
| `LOG_MAX_SIZE` | `50m` | Max log file size before rotation (supports b, k, m, g) |
| `LOG_MAX_FILES` | `5` | Number of rotated files to keep per category |

## Lifecycle Integration

The LogCollector integrates with all container lifecycle events in `ContainerManager`:
- **create**: attach after container starts
- **stop**: detach before stopping
- **restart**: detach before restart, re-attach after
- **remove**: detach before removal
- **archive**: detach before archiving
- **rebuild**: detach old container, attach new one
- **unarchive**: attach after new container starts

TraefikManager also calls `attach()`/`detach()` when creating/removing the Traefik container.
