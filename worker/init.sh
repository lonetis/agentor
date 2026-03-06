#!/bin/bash
# Runs WORKER.initScript via memfd, or falls back to plain bash.
# Used as the tmux pane command in entrypoint.sh Phase 8.
SCRIPT=$(echo "$WORKER" | jq -r '.initScript // ""')
[ -z "$SCRIPT" ] && exec bash
echo "$SCRIPT" | python3 /home/agent/memfd-exec.py
