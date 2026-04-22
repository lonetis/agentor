# Modular App System

Apps run inside worker containers and are managed via `orchestrator/server/utils/apps.ts` (`APP_REGISTRY`). Each app type has a `manage.sh` script in `worker/apps/<id>/` that implements a small shell interface — `start <id> <port> [extraArgs…]`, `stop <id>`, `list` — and emits NDJSON on stdout. The orchestrator reads that output via `docker exec` and the generic `/api/containers/:id/apps/*` endpoints.

## `AppType` fields

Every entry in `APP_REGISTRY` has:

- **`id`**, **`displayName`**, **`description`** — registry identity.
- **`ports: AppPort[]`** — zero or more port-range definitions. Entry `0` drives the port selector / label in the UI. For apps with `fixedInternalPort` the range is collapsed to a single port.
- **`maxInstances`** — upper bound for non-singleton apps (e.g. chromium caps at 10). Ignored when `singleton: true`.
- **`manageScript`** — path relative to `/home/agent/apps/` inside the worker.
- **`singleton?: boolean`** — only one instance can run; the instance id is always the app-type id (`'vscode'`, `'ssh'`) so restarts reuse the same row + port mapping. Starting while one is running returns HTTP **409**.
- **`fixedInternalPort?: number`** — when set, the orchestrator skips the port-range scan and always passes this port to `manage.sh start`. Used by the SSH app (internal port is hard-coded to 22).
- **`autoPortMapping?: { type, externalPortStart, externalPortEnd }`** — when set, starting the app also allocates a port mapping in `[externalPortStart, externalPortEnd]` and writes it to the port-mapping store with `appType` + `instanceId`. If the store already has a matching `(containerName, appType, instanceId)` mapping, it is reused — external port stays stable across stop/start/restart/rebuild.

## `manage.sh` interface

Every script must implement the same CLI. Stdout is NDJSON (one JSON object per line); a non-zero exit code plus an `{"status":"error","message":"…"}` line signal failure.

```
manage.sh start <id> <port> [extra args…]   # emit {"id","port","status":"running", …}
manage.sh stop  <id>                        # emit {"id","status":"stopped"} (idempotent)
manage.sh list                              # emit zero or more {"id","port","status", …} lines
```

Optional per-app fields on `list`:

- `machineName` (vscode) — the Microsoft tunnel machine name once connected.
- `authUrl`, `authCode` (vscode) — shown while the tunnel is in `auth_required` state.
- `externalPort` (populated server-side from the port-mapping store, not by manage.sh).

## Current Apps

| id | Kind | Internal port | Auto port mapping | Extra args |
|----|------|---------------|-------------------|------------|
| `chromium` | multi (max 10) | 9222–9322 | — | — |
| `socks5`   | multi (max 10) | 1080–1180 | — | — |
| `vscode`   | singleton      | — (`0`)   | — | Microsoft tunnel name (userId-prefixed, ≤ 20 chars) |
| `ssh`      | singleton      | 22 (fixed) | ext 22000–22999 (`type: external`) | — |

The VS Code tunnel and SSH apps used to be separate features with dedicated UI and API routes; they are now regular apps rendered in the Apps pane via specialised row components (`VsCodeAppRow.vue`, `SshAppRow.vue`).

## Adding a New App

1. Add an entry to `APP_REGISTRY` in `orchestrator/server/utils/apps.ts`.
2. Create `worker/apps/<id>/manage.sh` implementing the NDJSON interface above.
3. Install any binaries in `worker/Dockerfile`.
4. (Optional) Add a specialised row component in `orchestrator/app/components/` and dispatch it from `AppsPane.vue` (`rowComponentFor`).
5. (Optional) Register the app's outbound domains in `orchestrator/server/utils/agent-config.ts` so the network firewall allowlist covers them in restricted modes.

## SSH app details

- Uses `openssh-server` with `StrictModes no` (bind-mount file ownership is irrelevant) and `PubkeyAuthentication yes`, `PasswordAuthentication no`. Only the `agent` user is allowed in.
- The authorized_keys file comes from the worker owner's **Account → SSH Access** textarea. `UserEnvVarStore.upsert` writes it to `<DATA_DIR>/users/<userId>/ssh/authorized_keys` on save, and every worker bind-mounts that file read-only at `/home/agent/.ssh/authorized_keys` — so updating the key in the dashboard is visible to every running SSH instance immediately.
- Port mapping is created on Start (type `external`, external port in `22000–22999`) and kept across stop/start/rebuild/archive/unarchive. It is only removed when the worker is permanently deleted.
