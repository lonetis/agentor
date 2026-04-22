#!/bin/bash
# VS Code tunnel app manager — called via docker exec
# Usage: manage.sh start <id> <port> <tunnelName>
#        manage.sh stop <id>
#        manage.sh list
#
# Singleton app: id is always "vscode", port is unused (0). The third positional
# arg on `start` is the Microsoft tunnel machine name.
#
# Output is NDJSON (one JSON object per line). `list` emits at most one object
# with a rich status — `auth_required` with authUrl+authCode while waiting for
# GitHub device-code auth, `running` with machineName once connected.

PIDS_DIR="/home/agent/pids"
PID_FILE="$PIDS_DIR/vscode.pid"
LOG_FILE="/tmp/vscode-tunnel.log"
mkdir -p "$PIDS_DIR"

emit_err() {
  printf '{"status":"error","message":%s}\n' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  exit 1
}

case "$1" in
  start)
    ID="$2"
    # PORT=$3 ignored — VS Code tunnel uses the Microsoft relay, no container port.
    NAME="$4"

    if [ -z "$NAME" ]; then
      emit_err "usage: manage.sh start <id> <port> <tunnelName>"
    fi

    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        emit_err "tunnel already running (pid $PID)"
      fi
      rm -f "$PID_FILE"
    fi

    # Fresh log per start so `list` never reports stale auth_required state.
    : > "$LOG_FILE"

    # Mirror tunnel output to /tmp/vscode-tunnel.log (parsed by `list` to extract
    # the GitHub device code) and to container stdout (captured by the log
    # collector with the [vscode-tunnel] tag). Process substitution keeps `$!`
    # pointing at `code tunnel` so `stop` can kill it cleanly.
    # `stdbuf -oL` on tee forces line-buffering so the device-code prompt lands
    # in the log file immediately instead of waiting for a full buffer to fill.
    code tunnel --accept-server-license-terms --name "$NAME" \
      > >(stdbuf -oL tee -a "$LOG_FILE" | stdbuf -oL -eL sed -u 's/^/[vscode-tunnel] /' >> /proc/1/fd/1) 2>&1 &

    echo "$!" > "$PID_FILE"
    printf '{"id":"%s","port":0,"status":"running"}\n' "${ID:-vscode}"
    ;;

  stop)
    ID="${2:-vscode}"

    if [ ! -f "$PID_FILE" ]; then
      printf '{"id":"%s","status":"stopped"}\n' "$ID"
      exit 0
    fi

    PID=$(cat "$PID_FILE")

    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      for i in $(seq 1 10); do
        if ! kill -0 "$PID" 2>/dev/null; then
          break
        fi
        sleep 0.5
      done
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID" 2>/dev/null
      fi
    fi

    rm -f "$PID_FILE"
    printf '{"id":"%s","status":"stopped"}\n' "$ID"
    ;;

  list)
    if [ ! -f "$PID_FILE" ]; then
      exit 0
    fi

    PID=$(cat "$PID_FILE")
    if ! kill -0 "$PID" 2>/dev/null; then
      rm -f "$PID_FILE"
      exit 0
    fi

    # Pin status by walking the whole log, not the tail — the device-code
    # prompt is emitted once near the top and may be well past `tail -30` by
    # the time the user clicks Start, polls, or re-opens the pane.
    STATUS="auth_required"
    MACHINE=""
    AUTH_URL=""
    AUTH_CODE=""

    if [ -f "$LOG_FILE" ]; then
      LAST_CODE_LINE=$(grep -nE '[A-Z0-9]{4}-[A-Z0-9]{4}' "$LOG_FILE" | tail -1 | cut -d: -f1)
      LAST_CONNECTED_LINE=$(grep -nE 'Connected|tunnel/' "$LOG_FILE" | tail -1 | cut -d: -f1)
      CODE_MATCH=$(grep -oE '[A-Z0-9]{4}-[A-Z0-9]{4}' "$LOG_FILE" | tail -1)

      # `needs_auth`: we're still before the first successful connection, OR a
      # fresh code was emitted after the last connection (re-auth required).
      needs_auth=1
      if [ -n "$LAST_CONNECTED_LINE" ]; then
        if [ -z "$LAST_CODE_LINE" ] || [ "$LAST_CODE_LINE" -le "$LAST_CONNECTED_LINE" ] 2>/dev/null; then
          needs_auth=0
        fi
      fi

      if [ "$needs_auth" = "1" ]; then
        STATUS="auth_required"
        if [ -n "$CODE_MATCH" ]; then
          AUTH_URL="https://github.com/login/device"
          AUTH_CODE="$CODE_MATCH"
        fi
      else
        STATUS="running"
        MACHINE=$(grep -oE 'tunnel/[^/ ]+' "$LOG_FILE" | tail -1 | sed 's|tunnel/||')
      fi
    fi

    # Emit a single JSON line with only the fields that have values.
    python3 - <<PY
import json
obj = {"id": "vscode", "port": 0, "status": "$STATUS"}
if "$MACHINE":
    obj["machineName"] = "$MACHINE"
if "$AUTH_URL":
    obj["authUrl"] = "$AUTH_URL"
if "$AUTH_CODE":
    obj["authCode"] = "$AUTH_CODE"
print(json.dumps(obj))
PY
    ;;

  *)
    emit_err "usage: manage.sh {start|stop|list}"
    ;;
esac
