# Logging System

## Overview

Centralized logging system that collects logs from all platform containers (orchestrator, workers, mapper, traefik) into the orchestrator. Logs are persisted to disk with rotation and streamed live to the web dashboard via WebSocket.

## Architecture

```
Worker containers ──┐
Mapper container  ──┤── dockerode container.logs({ follow }) ──→ LogCollector ──→ LogStore (NDJSON files)
Traefik container ──┘                                                         ──→ LogBroadcaster (WebSocket)
Orchestrator code ──→ Logger ──→ LogStore + LogBroadcaster

Browser (LogPane) ←── WebSocket /ws/logs ←── LogBroadcaster
Browser (LogPane) ←── REST GET /api/logs ←── LogStore
```

Four components:
- **Logger** (`logger.ts`): Replaces `console.log/warn/error` in the orchestrator. Buffers entries before `setReady()` during early startup.
- **LogStore** (`log-store.ts`): NDJSON file storage with size-based rotation. Two log categories: `orchestrator.log` and `containers.log`.
- **LogBroadcaster** (`log-broadcaster.ts`): Manages WebSocket peers for live log streaming.
- **LogCollector** (`log-collector.ts`): Attaches to Docker containers via `container.logs({ follow: true })`. Handles both TTY and non-TTY (demuxed) streams. Parses Docker timestamps and detects log level heuristically.

## Log Entry Format

```typescript
interface LogEntry {
  timestamp: string;    // ISO 8601
  level: LogLevel;      // 'debug' | 'info' | 'warn' | 'error'
  source: LogSource;    // 'orchestrator' | 'worker' | 'mapper' | 'traefik'
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
├── containers.log         ← all container logs (workers, mapper, traefik)
└── containers.1.log       ← rotated
```

**Rotation**: When a log file exceeds `LOG_MAX_SIZE`, it's renamed to `.1.log`, shifting existing rotated files up. The oldest file (`.{LOG_MAX_FILES}.log`) is deleted. Default: 50MB max size, 5 rotated files per category.

## Container Log Collection

The LogCollector attaches to all managed containers (label `agentor.managed`) on startup and when containers are created/started. It detaches when containers are stopped/removed.

**Source detection**: The `agentor.managed` label value determines the source type:
- `true` → `worker`
- `mapper` → `mapper`
- `traefik` → `traefik`

**TTY vs non-TTY**: Worker containers use TTY mode (raw stream). Mapper and traefik containers may use non-TTY mode (multiplexed 8-byte header frames, demuxed via `docker.modem.demuxStream`).

**Level detection**: Log level is detected heuristically from message content:
- `[error]`, `error:` → error
- `[warn]`, `warning:` → warn
- `[debug]`, `debug:` → debug
- Default → info

## Web UI (LogPane)

The log pane opens via the "Logs" button in the System tab's Quick Links section. It renders as a split pane tab (type `'logs'`, ID `'__logs__'`).

**Features**:
- Live WebSocket streaming with auto-reconnect (3s)
- Filter by source (orchestrator, worker, mapper, traefik) — toggle buttons
- Filter by level (debug, info, warn, error) — toggle buttons
- Text search with 300ms debounce
- Auto-scroll to bottom (disables on manual scroll up, re-enables at bottom)
- Color-coded level badges: debug (gray), info (blue), warn (amber), error (red)
- Color-coded source badges: orchestrator (purple), worker (green), mapper (cyan), traefik (orange)
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
| `sources` | string | Comma-separated: `orchestrator,worker,mapper,traefik` |
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

MapperManager and TraefikManager also call `attach()`/`detach()` when creating/removing their containers.
