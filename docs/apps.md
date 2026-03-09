# Modular App System

Apps run inside worker containers and are managed via `orchestrator/server/utils/apps.ts` (`APP_REGISTRY`). Each app type has a manage script in `worker/apps/` and internal port ranges.

## Adding a New App

1. Add a registry entry in `orchestrator/server/utils/apps.ts`
2. Create `worker/apps/<app>/manage.sh` (start/stop/list pattern)
3. Install the app binary in `worker/Dockerfile`

## Current Apps

- **chromium**: Chromium with CDP (ports 9222-9322)
- **socks5**: microsocks SOCKS5 proxy (ports 1080-1180)
