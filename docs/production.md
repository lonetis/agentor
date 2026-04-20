# Production Systems

## Update Mechanism

Automatic image update detection and per-image or bulk updates for production deployments. Active when `WORKER_IMAGE_PREFIX` is set (GHCR images) and/or `BASE_DOMAINS` is set (Traefik). Tracks three images: orchestrator, worker (GHCR), and traefik (Docker Hub).

**Architecture:**
- `UpdateChecker` (`update-checker.ts`): Registry-agnostic digest checker. Parses image references (`parseImageRef`) to handle GHCR (`ghcr.io/org/repo:tag`), Docker Hub user images (`user/repo:tag`), and official images (`traefik:v3` → `library/traefik`). Token acquisition (`getRegistryToken`) handles GHCR (Basic auth + Bearer) and Docker Hub (anonymous token) separately. Polls every 5 minutes.
- `UpdateNotification.vue`: Sidebar component showing per-image status with individual "Update" buttons and a bulk "Update All" button
- `useUpdates.ts`: composable for update status polling (60s), `applyUpdates()` for bulk, `applyImage(key)` for per-image updates

**Update flow:**
1. Worker: pull new image → workers use new image on next create (existing workers keep the previous image until rebuilt)
2. Traefik: pull new image → recreate Traefik container (via `TraefikManager.forceRecreate()`) → TLS certs persist on named volume
3. Orchestrator: pull new image → create replacement container with temp name (`-next`) → spawn a one-shot swapper container (`-swapper`, `AutoRemove: true`) that uses the Docker socket to stop→remove→rename→start the replacement → UI polls `/api/health` until server returns. The swapper is needed because stopping the orchestrator's own container kills the Node.js process, so the remaining steps (remove, create, start) can't run in-process.

**Per-image updates:** The apply endpoint accepts an optional `{ images: UpdatableImage[] }` body to pull only specific images. The `UpdatableImage` type (`'orchestrator' | 'worker' | 'traefik'`) is defined in `shared/types.ts`.

**No version numbers** — only image digest hashes (sha256) are compared and displayed. Workers are NOT automatically restarted; they pick up the new image when next created or unarchived.

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
