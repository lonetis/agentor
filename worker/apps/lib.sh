#!/bin/bash
# Shared helpers for app manage.sh scripts.
# Source this from each app: source "$(dirname "$0")/../lib.sh"
#
# Every app exposes the same NDJSON CLI: `start <id> <port> [extra…]`,
# `stop <id>`, `list`. These helpers cover the parts that were copy-pasted
# across all four apps so a new app only has to define its launch line.

# Emit a single-line `{"status":"error","message":"…"}` and exit non-zero.
# Uses jq (the image's standard JSON tool) to escape the message — no Python
# process spawn. Usage: emit_err "human-readable cause"
emit_err() {
  jq -cn --arg m "$1" '{status:"error",message:$m}'
  exit 1
}

# True when the PID recorded in <pidfile> is alive. Usage: is_running <pidfile>
is_running() {
  local pidfile="$1"
  [ -f "$pidfile" ] || return 1
  local pid
  pid=$(cat "$pidfile" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Gracefully stop a process: TERM, wait up to ~5s, then KILL.
# Pass `sudo` as the 2nd arg when the process was started under sudo (sshd).
# Usage: kill_pid_graceful <pid> [sudo]
kill_pid_graceful() {
  local pid="$1" priv="$2"
  kill -0 "$pid" 2>/dev/null || return 0
  $priv kill "$pid" 2>/dev/null
  local i
  for i in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  $priv kill -9 "$pid" 2>/dev/null
}
