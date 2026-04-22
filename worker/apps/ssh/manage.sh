#!/bin/bash
# SSH server app manager — called via docker exec
# Usage: manage.sh start <id> <port>
#        manage.sh stop <id>
#        manage.sh list
#
# Singleton app: id is always "ssh", port is always 22. The authorised public
# key is bind-mounted read-only at `/home/agent/.ssh/authorized_keys` from the
# worker owner's account settings; sshd uses `StrictModes no` so host ownership
# of that file does not matter.
#
# Output is NDJSON.

PIDS_DIR="/home/agent/pids"
PID_FILE="$PIDS_DIR/ssh.pid"
LOG_FILE="/tmp/sshd.log"
SSHD_CONFIG="/etc/ssh/sshd_config"
mkdir -p "$PIDS_DIR"

emit_err() {
  printf '{"status":"error","message":%s}\n' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  exit 1
}

case "$1" in
  start)
    ID="${2:-ssh}"
    PORT="${3:-22}"

    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        emit_err "sshd already running (pid $PID)"
      fi
      rm -f "$PID_FILE"
    fi

    # Runtime dirs (handy when the bind-mount target doesn't exist yet).
    sudo mkdir -p /run/sshd
    mkdir -p /home/agent/.ssh
    chmod 700 /home/agent/.ssh

    # Generate host keys on first run; /etc/ssh is baked into the image with no
    # host keys (the image is the same for every container).
    if ! ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1; then
      sudo ssh-keygen -A >/dev/null 2>&1
    fi

    # Sanity-check the authorized_keys file. It is bind-mounted read-only from
    # the worker owner's `Account → SSH Access` textarea. If the worker was
    # created before the SSH app was added to agentor, the bind mount is
    # missing and this file won't exist — in that case rebuild the worker from
    # the dashboard. If the file exists but is empty, the user hasn't saved a
    # public key yet.
    AUTH_KEYS_FILE="/home/agent/.ssh/authorized_keys"
    if [ ! -e "$AUTH_KEYS_FILE" ]; then
      {
        echo "[sshd] WARNING: $AUTH_KEYS_FILE does not exist — bind mount missing."
        echo "[sshd] WARNING: This worker predates the SSH app. Click 'Rebuild' on the worker to pick up the new bind mount."
      } >> /proc/1/fd/1
      touch "$AUTH_KEYS_FILE"
      chmod 600 "$AUTH_KEYS_FILE"
    elif [ ! -s "$AUTH_KEYS_FILE" ]; then
      echo "[sshd] WARNING: $AUTH_KEYS_FILE is empty — add a public key in 'Account → SSH Access' so sshd can accept logins." >> /proc/1/fd/1
    fi

    # Verbose diagnostic line — lands in the worker log pane so the operator
    # can see what the bind mount actually delivered without docker exec'ing.
    {
      echo "[sshd] diagnostic: $AUTH_KEYS_FILE"
      ls -la "$AUTH_KEYS_FILE" 2>&1 | sed 's/^/[sshd] ls: /'
      # Print the *type* of key(s) without revealing full material.
      awk '{print $1}' "$AUTH_KEYS_FILE" 2>/dev/null | sed 's/^/[sshd] key-type: /'
      /usr/sbin/sshd -t -f "$SSHD_CONFIG" 2>&1 | sed 's/^/[sshd] config-check: /' || true
    } >> /proc/1/fd/1

    # Start sshd in the foreground (-D) with `-e` so connection diagnostics
    # land on stderr (captured by our redirect). Background it so the script
    # can return the running-status JSON while sshd keeps accepting clients.
    sudo /usr/sbin/sshd -D -e -f "$SSHD_CONFIG" -p "$PORT" \
      > >(tee -a "$LOG_FILE" | stdbuf -oL -eL sed -u 's/^/[sshd] /' >> /proc/1/fd/1) 2>&1 &

    SSHD_PID=$!

    # Give sshd a moment to bind; if it exited immediately (e.g. port in use)
    # report the failure to the caller.
    sleep 0.3
    if ! kill -0 "$SSHD_PID" 2>/dev/null; then
      LAST=$(tail -20 "$LOG_FILE" 2>/dev/null | tr '\n' ' ')
      emit_err "sshd exited immediately: $LAST"
    fi

    echo "$SSHD_PID" > "$PID_FILE"
    printf '{"id":"%s","port":%s,"status":"running"}\n' "$ID" "$PORT"
    ;;

  stop)
    ID="${2:-ssh}"

    if [ ! -f "$PID_FILE" ]; then
      printf '{"id":"%s","status":"stopped"}\n' "$ID"
      exit 0
    fi

    PID=$(cat "$PID_FILE")

    if kill -0 "$PID" 2>/dev/null; then
      sudo kill "$PID" 2>/dev/null
      for i in $(seq 1 10); do
        if ! kill -0 "$PID" 2>/dev/null; then
          break
        fi
        sleep 0.5
      done
      if kill -0 "$PID" 2>/dev/null; then
        sudo kill -9 "$PID" 2>/dev/null
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
    printf '{"id":"ssh","port":22,"status":"running"}\n'
    ;;

  *)
    emit_err "usage: manage.sh {start|stop|list}"
    ;;
esac
