#!/bin/bash
# Chromium instance manager — called via docker exec
# Usage: manage.sh start <id> <port>
#        manage.sh stop <id>
#        manage.sh list
#
# Output is NDJSON. Failures exit non-zero and emit
# `{"status":"error","message":"…"}`.

source "$(dirname "$0")/../lib.sh"

PIDS_DIR="/home/agent/pids"
PROFILES_DIR="/home/agent/profiles"
mkdir -p "$PIDS_DIR" "$PROFILES_DIR"

case "$1" in
  start)
    ID="$2"
    PORT="$3"

    if [ -z "$ID" ] || [ -z "$PORT" ]; then
      emit_err "usage: manage.sh start <id> <port>"
    fi

    if [ -f "$PIDS_DIR/$ID.pid" ]; then
      PID=$(cat "$PIDS_DIR/$ID.pid")
      if kill -0 "$PID" 2>/dev/null; then
        emit_err "instance $ID already running (pid $PID)"
      fi
      rm -f "$PIDS_DIR/$ID.pid" "$PIDS_DIR/$ID.port"
    fi

    mkdir -p "$PROFILES_DIR/$ID"

    DISPLAY=:99 chromium \
      --user-data-dir="$PROFILES_DIR/$ID" \
      --remote-debugging-port="$PORT" \
      --remote-debugging-address=0.0.0.0 \
      --no-first-run \
      --no-sandbox \
      --disable-dev-shm-usage \
      --disable-gpu \
      --start-maximized > >(stdbuf -oL -eL sed -u "s/^/[chromium-$ID] /" >> /proc/1/fd/1) 2>&1 &

    CHROMIUM_PID=$!
    echo "$CHROMIUM_PID" > "$PIDS_DIR/$ID.pid"
    echo "$PORT" > "$PIDS_DIR/$ID.port"

    printf '{"id":"%s","port":%s,"status":"running"}\n' "$ID" "$PORT"
    ;;

  stop)
    ID="$2"

    if [ -z "$ID" ]; then
      emit_err "usage: manage.sh stop <id>"
    fi

    if [ ! -f "$PIDS_DIR/$ID.pid" ]; then
      # Idempotent stop
      printf '{"id":"%s","status":"stopped"}\n' "$ID"
      exit 0
    fi

    PID=$(cat "$PIDS_DIR/$ID.pid")
    kill_pid_graceful "$PID"

    rm -f "$PIDS_DIR/$ID.pid" "$PIDS_DIR/$ID.port"
    printf '{"id":"%s","status":"stopped"}\n' "$ID"
    ;;

  list)
    for pidfile in "$PIDS_DIR"/*.pid; do
      [ -f "$pidfile" ] || continue
      ID=$(basename "$pidfile" .pid)
      case "$ID" in chromium-*) ;; *) continue ;; esac
      PID=$(cat "$pidfile")
      PORT=0
      if [ -f "$PIDS_DIR/$ID.port" ]; then
        PORT=$(cat "$PIDS_DIR/$ID.port")
      fi
      if kill -0 "$PID" 2>/dev/null; then
        printf '{"id":"%s","port":%s,"status":"running"}\n' "$ID" "$PORT"
      else
        rm -f "$PIDS_DIR/$ID.pid" "$PIDS_DIR/$ID.port"
      fi
    done
    ;;

  *)
    emit_err "usage: manage.sh {start|stop|list}"
    ;;
esac
