#!/bin/bash
# SOCKS5 proxy instance manager — called via docker exec
# Usage: manage.sh start <id> <port>
#        manage.sh stop <id>
#        manage.sh list
#
# Output is NDJSON (one JSON object per line). Failures exit non-zero and emit
# `{"status":"error","message":"…"}` so the orchestrator can surface the cause.

source "$(dirname "$0")/../lib.sh"

PIDS_DIR="/home/agent/pids"
mkdir -p "$PIDS_DIR"

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

    microsocks -i 0.0.0.0 -p "$PORT" > >(stdbuf -oL -eL sed -u "s/^/[socks5-$ID] /" >> /proc/1/fd/1) 2>&1 &

    SOCKS_PID=$!
    echo "$SOCKS_PID" > "$PIDS_DIR/$ID.pid"
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
      case "$ID" in socks5-*) ;; *) continue ;; esac
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
