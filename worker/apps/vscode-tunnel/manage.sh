#!/bin/bash
# VS Code tunnel manager — called via docker exec
# Usage: manage.sh start <name>
#        manage.sh stop
#        manage.sh status

PIDS_DIR="/home/agent/pids"
PID_FILE="$PIDS_DIR/vscode-tunnel.pid"
LOG_FILE="/tmp/vscode-tunnel.log"

mkdir -p "$PIDS_DIR"

case "$1" in
  start)
    NAME="$2"

    if [ -z "$NAME" ]; then
      echo "ERR:usage: manage.sh start <name>"
      exit 1
    fi

    # Check for existing process
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo "ERR:tunnel already running (pid $PID)"
        exit 1
      fi
      rm -f "$PID_FILE"
    fi

    code tunnel --accept-server-license-terms --name "$NAME" > "$LOG_FILE" 2>&1 &

    echo "$!" > "$PID_FILE"
    echo "OK:$NAME"
    ;;

  stop)
    if [ ! -f "$PID_FILE" ]; then
      echo "OK:not running"
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
    echo "OK:stopped"
    ;;

  status)
    # Check if process is alive
    RUNNING=false
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        RUNNING=true
      else
        rm -f "$PID_FILE"
      fi
    fi

    if [ "$RUNNING" = "false" ]; then
      echo "STATUS:stopped"
      exit 0
    fi

    # Parse log for state
    if [ -f "$LOG_FILE" ]; then
      LOG_TAIL=$(tail -30 "$LOG_FILE")

      # Check for auth required (device code flow)
      AUTH_LINE=$(echo "$LOG_TAIL" | grep -oE 'https://github\.com/login/device' | tail -1)
      CODE_LINE=$(echo "$LOG_TAIL" | grep -oE 'use code ([A-Z0-9]{4}-[A-Z0-9]{4})' | tail -1)

      if [ -n "$AUTH_LINE" ] && [ -n "$CODE_LINE" ]; then
        # Check if auth was completed (connected message after auth prompt)
        LAST_AUTH_LINE=$(grep -n 'use code' "$LOG_FILE" | tail -1 | cut -d: -f1)
        LAST_CONNECTED_LINE=$(grep -n -E 'Connected|tunnel/' "$LOG_FILE" | tail -1 | cut -d: -f1)

        if [ -z "$LAST_CONNECTED_LINE" ] || [ "$LAST_AUTH_LINE" -gt "$LAST_CONNECTED_LINE" ] 2>/dev/null; then
          AUTH_CODE=$(echo "$CODE_LINE" | sed 's/use code //')
          echo "STATUS:auth_required"
          echo "AUTH_URL:https://github.com/login/device"
          echo "AUTH_CODE:$AUTH_CODE"
          exit 0
        fi
      fi

      # Check for connected state
      if echo "$LOG_TAIL" | grep -qE 'Connected|tunnel/'; then
        # Extract machine name from log
        MACHINE=$(echo "$LOG_TAIL" | grep -oE 'tunnel/[^/]+' | tail -1 | sed 's|tunnel/||')
        echo "STATUS:running"
        [ -n "$MACHINE" ] && echo "MACHINE:$MACHINE"
        exit 0
      fi
    fi

    # Process alive but no clear state — still starting
    echo "STATUS:running"
    ;;

  *)
    echo "ERR:usage: manage.sh {start|stop|status}"
    exit 1
    ;;
esac
