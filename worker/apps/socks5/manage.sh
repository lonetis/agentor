#!/bin/bash
# SOCKS5 proxy instance manager — called via docker exec
# Usage: socks5-manage.sh start <id> <port>
#        socks5-manage.sh stop <id>
#        socks5-manage.sh list

PIDS_DIR="/home/agent/pids"

mkdir -p "$PIDS_DIR"

case "$1" in
  start)
    ID="$2"
    PORT="$3"

    if [ -z "$ID" ] || [ -z "$PORT" ]; then
      echo "ERR:usage: socks5-manage.sh start <id> <port>"
      exit 1
    fi

    if [ -f "$PIDS_DIR/$ID.pid" ]; then
      PID=$(cat "$PIDS_DIR/$ID.pid")
      if kill -0 "$PID" 2>/dev/null; then
        echo "ERR:instance $ID already running (pid $PID)"
        exit 1
      fi
      # Stale PID file, clean up
      rm -f "$PIDS_DIR/$ID.pid" "$PIDS_DIR/$ID.port"
    fi

    microsocks -i 0.0.0.0 -p "$PORT" &

    SOCKS_PID=$!
    echo "$SOCKS_PID" > "$PIDS_DIR/$ID.pid"
    echo "$PORT" > "$PIDS_DIR/$ID.port"

    echo "OK:$ID:$PORT:$SOCKS_PID"
    ;;

  stop)
    ID="$2"

    if [ -z "$ID" ]; then
      echo "ERR:usage: socks5-manage.sh stop <id>"
      exit 1
    fi

    if [ ! -f "$PIDS_DIR/$ID.pid" ]; then
      echo "ERR:instance $ID not found"
      exit 1
    fi

    PID=$(cat "$PIDS_DIR/$ID.pid")

    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      # Wait up to 5 seconds for graceful shutdown
      for i in $(seq 1 10); do
        if ! kill -0 "$PID" 2>/dev/null; then
          break
        fi
        sleep 0.5
      done
      # Force kill if still alive
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID" 2>/dev/null
      fi
    fi

    rm -f "$PIDS_DIR/$ID.pid" "$PIDS_DIR/$ID.port"
    echo "OK:$ID:stopped"
    ;;

  list)
    for pidfile in "$PIDS_DIR"/*.pid; do
      [ -f "$pidfile" ] || continue
      ID=$(basename "$pidfile" .pid)
      # Only list socks5 instances (prefixed with socks5-)
      case "$ID" in socks5-*) ;; *) continue ;; esac
      PID=$(cat "$pidfile")
      PORT=""
      if [ -f "$PIDS_DIR/$ID.port" ]; then
        PORT=$(cat "$PIDS_DIR/$ID.port")
      fi
      if kill -0 "$PID" 2>/dev/null; then
        echo "$ID:$PORT:running"
      else
        # Clean up stale entry
        rm -f "$PIDS_DIR/$ID.pid" "$PIDS_DIR/$ID.port"
      fi
    done
    ;;

  *)
    echo "ERR:usage: socks5-manage.sh {start|stop|list}"
    exit 1
    ;;
esac
