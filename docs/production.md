# Production Systems

## Update Mechanism

Automatic image update detection and per-image or bulk updates for production deployments. Active when `WORKER_IMAGE_PREFIX` is set (GHCR images) and/or `BASE_DOMAINS` is set (Traefik). Tracks three images: orchestrator, worker (GHCR), and traefik (Docker Hub).

**Architecture:**
- `UpdateChecker` (`update-checker.ts`): Registry-agnostic digest checker. Parses image references (`parseImageRef`) to handle GHCR (`ghcr.io/org/repo:tag`), Docker Hub user images (`user/repo:tag`), and official images (`traefik:v3` → `library/traefik`). Token acquisition (`getRegistryToken`) handles GHCR (Basic auth + Bearer) and Docker Hub (anonymous token) separately; any other registry is asked for its `WWW-Authenticate` challenge and authenticated against the realm it names (Bearer token) or with Basic auth. Polls every 5 minutes.
- `UpdateNotification.vue`: Sidebar component showing per-image status with individual "Update" buttons and a bulk "Update All" button
- `useUpdates.ts`: composable for update status polling (60s), `applyUpdates()` for bulk, `applyImage(key)` for per-image updates

**Update flow:**
1. Worker: pull new image → workers use new image on next create (existing workers keep the previous image until rebuilt)
2. Traefik: pull new image → recreate Traefik container (via `TraefikManager.forceRecreate()`) → TLS certs persist on named volume
3. Orchestrator: pull new image → create replacement container with temp name (`-next`) → spawn a one-shot swapper container (`-swapper`, `AutoRemove: true`) that uses the Docker socket to stop→remove→rename→start the replacement → UI polls `/api/health` until server returns. The swapper is needed because stopping the orchestrator's own container kills the Node.js process, so the remaining steps (remove, create, start) can't run in-process.

**Private registries:** `registry-auth.ts` resolves credentials per registry host — first from `REGISTRY_CREDENTIALS` (`host=username:password`, comma-separated; `docker.io` for Docker Hub), then from a docker `config.json` (`$DOCKER_CONFIG/config.json` or `~/.docker/config.json`, inline `auths` only, re-read on every lookup). They are passed to every pull the orchestrator makes (`authconfig`) and to the digest checks. Without either, pulls and checks stay anonymous. `ORCHESTRATOR_IMAGE` may be fully qualified (its first path segment is a registry host), in which case `WORKER_IMAGE_PREFIX` is not prepended — so a self-built orchestrator in its own registry is checked and updated in place instead of being swapped for the prefixed upstream image.

**Per-image updates:** The apply endpoint accepts an optional `{ images: UpdatableImage[] }` body to pull only specific images. The `UpdatableImage` type (`'orchestrator' | 'worker' | 'traefik'`) is defined in `shared/types.ts`.

**No version numbers** — only image digest hashes (sha256) are compared and displayed. Workers are NOT automatically restarted; they pick up the new image when next created or unarchived.

## Image Dependency Refresh (CI)

The `latest` images are rebuilt on a schedule so unpinned dependencies do not
drift. Nothing in the repo is pinned to a version — the base images, every apt
package, and the Claude / Codex / Gemini CLIs all resolve at build time — so a
rebuild of the same Dockerfile is what picks up upstream updates. Without a
scheduled rebuild, `latest` would freeze at whatever was current on the last
source change.

`.github/workflows/docker-refresh.yml` runs **daily at 04:00 UTC** and on manual
dispatch (Actions → Refresh Docker Images → Run workflow):

1. **Rebuild both images cache-free.** Calls the shared
   `docker-image.yml` with `refresh: true`, which sets `no-cache` (so the
   `apt-get install` / CLI-install layers actually re-run instead of being
   restored from the GHA cache) and `pull` (so `ubuntu:24.04` and
   `node:22-alpine` re-resolve to the current digest). The refreshed layers are
   still exported to the build cache, so the next source-change build starts
   from them rather than from stale ones.
2. **Publish under a dated tag only** — `refresh-YYYYMMDD`. `latest` is not
   touched yet.
3. **Smoke-test on amd64 and arm64.** The worker image must report versions for
   `claude`, `codex`, `gemini`, node, npm, git, tmux, chromium, code-server and
   glab, and carry the expected binaries (`gh`, `glab`, `code`, `docker`, `dnsmasq`,
   `microsocks`, `x11vnc`, `Xvfb`, `maim`, `xdotool`, `sshd`). The orchestrator
   image must boot against a Docker socket and answer `GET /api/health` with
   `status: ok`.
4. **Promote to `latest` + `main`** by retagging the verified manifest (no
   layers re-uploaded).

A broken upstream package therefore fails the workflow instead of reaching
deployments, which pull `latest` through the update mechanism above. The dated
`refresh-*` tags are kept as rollback targets — pin a compose file to one to
step back to a known-good build.

**Not covered by the refresh:** the orchestrator's npm dependencies are pinned
by `package-lock.json`, so a rebuild reinstalls the same versions by design.
Bumping those is a source change (e.g. Dependabot / Renovate on
`orchestrator/package.json`), not an image rebuild.

**Scheduled workflows are disabled by GitHub after 60 days without repository
activity** — re-enable from the Actions tab if the daily run stops firing.

## Agent Usage Monitoring

Polls agent usage APIs to show each user's remaining capacity in the sidebar. Works for OAuth-authenticated agents (per-user credential files at `<DATA_DIR>/users/<userId>/credentials/{claude,codex,gemini}.json`, or the per-user `CLAUDE_CODE_OAUTH_TOKEN` set in the Account modal). API key auth has no usage endpoints.

**Architecture:**
- `UsageChecker` (`usage-checker.ts`): Singleton + 5min polling. State is per-user — `Map<userId, Map<agentId, AgentState>>` — persisted to `usage.json` in the data directory. Each user's agents track their own fetch time and backoff independently. On restart, serves persisted results immediately; only re-fetches agents whose data is stale. Reads each user's credential files via `UserCredentialManager`, detects auth type per agent (OAuth > API key > none) per-user, fetches usage in parallel.
- `/api/usage` and `/api/usage/refresh` are auth-gated. Each call returns only `requireAuth(event).user.id`'s state — users never see one another's usage.
- `UsagePanel.vue`: Sidebar component showing per-agent auth badge + progress bars per usage window + "Fetched Xm ago" relative timestamp (for the signed-in user only)
- `useUsage.ts`: composable for 5min polling of `/api/usage`

**Supported agents:**

| Agent | Endpoint | Auth | Token Refresh |
|-------|----------|------|---------------|
| Claude | `GET https://api.anthropic.com/api/oauth/usage` | Bearer + `anthropic-beta: oauth-2025-04-20` | Not needed (CLI handles it). Supports per-user `claude.json` OAuth or per-user `CLAUDE_CODE_OAUTH_TOKEN` from Account env vars |
| Codex | `GET https://chatgpt.com/backend-api/wham/usage` | Bearer (+ optional `ChatGPT-Account-Id`) | Hardcoded client_id, refreshes when `last_refresh` > 8 days. Refreshed token is written back to that user's `codex.json`. |
| Gemini | `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` | Bearer | Not implemented (CLI client_id/secret not available in orchestrator); reports error if token expired |

**Normalized output:** All APIs are mapped to a common `UsageWindow` type with `label`, `utilization` (0-100%), and `resetsAt` (ISO 8601). Claude shows Session/Weekly/Sonnet windows, Codex shows Session/Weekly (+ Reserve when credits available), Gemini shows per-model-family windows (Pro/Flash). Progress bars use green (<50%), amber (50-79%), red (>=80%) coloring.

## Resource Monitoring

Live **per-worker** CPU / RAM / disk / network metrics, shown on each worker card. There is intentionally **no host/system metrics** — whole-host CPU/RAM/disk are OS- and runtime-dependent (host `/proc` parsing, `statfs` over virtiofs on Docker Desktop, etc.), so the feature is scoped to per-worker metrics that are derived entirely through the Docker API and behave identically everywhere. Independent of agent usage monitoring.

**Architecture:**
- `ResourceMonitor` (`resource-monitor.ts`): singleton poller, structurally mirrors `UsageChecker` but holds **no persistence** — metrics are ephemeral, kept in memory only. Started in the services plugin after `reconcileWorkers()`. Two cadences, each with an overlap guard so a slow sample never stacks the next tick: a fast 3s poll for cpu/mem/net and a slow 60s poll for disk.
- **cpu / memory / network** come from dockerode `container.stats({ stream: false })` for each running worker (no compose change — the Docker socket is already mounted). CPU% is the cgroup `cpu_stats`/`precpu_stats` delta as a fraction of total host capacity; memory subtracts `inactive_file` to match `docker stats`; network rates derive from the previous sample (kept per `containerName`).
- **disk** is sampled on the slower 60s cadence as the container's writable-layer size (Docker `SizeRw` via `inspect({ size: true })`, which excludes the read-only base image — this captures files the worker writes anywhere in its own fs) plus a `du` of its `/workspace` + agent-data volumes (storage-mode-agnostic). It is kept in a separate map and overlaid onto each `WorkerMetrics` on read. The DinD image store (`/var/lib/docker`) is excluded. The manual refresh bypasses both interval guards so a just-created worker is reliably sampled.

**Normalized type** (`shared/types.ts`): `WorkerMetrics` (per-worker cpu/mem/disk/net/blkio). The UI reuses the usage progress-bar color scheme (green <50, amber 50-79, red ≥80).

**Endpoints:** `GET /api/worker-metrics` (caller-owned workers; admins see all), `POST /api/worker-metrics/refresh` (force a sample), `GET /api/containers/:id/metrics` (single worker, ownership-checked). All auth-gated. Composable: `useWorkerMetrics` (sidebar → per-card `metric` prop, 10s poll).

## Worker Export / Import

Download a complete, portable snapshot of a worker and restore it as a brand-new worker — on the same or another machine.

**Export** (`GET /api/containers/:id/export`, `ContainerManager.exportWorker`) streams a single `.tar` bundle, materialised to a temp dir then packed (sizes known, no buffering):
- `manifest.json` — the worker's own config + the **embedded environment definition** + its port/domain mappings (so it restores where that environment doesn't exist).
- `workspace.tar.gz`, `agents.tar.gz` — the two persistent volumes (the per-user OAuth credential files inside the agents dir are **stripped** so an export never leaks another user's tokens).
- `rootfs.tar.gz` — a `docker export` of the container filesystem (captures non-volume changes). Included by default; `?includeRootfs=false` omits it (much smaller/faster — used by the test suite).

**Import** (`POST /api/containers/import`, raw `.tar` body streamed to disk, `ContainerManager.importWorker`): mints a fresh UUID worker, resolves/recreates the environment, `docker import`s the rootfs into a per-worker image (`agentor-import-<id>`, replicating the standard image's entrypoint/env so it boots — falls back to the standard image on any failure), creates the container **stopped**, restores the volumes via `putArchive`, starts it, then recreates the mappings (skipping conflicts / base domains not configured locally). The per-worker image link (`importedImage` on the `WorkerRecord`) survives rebuild/unarchive and is removed on permanent delete.
