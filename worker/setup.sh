#!/bin/bash
# Runs ENVIRONMENT.setupScript via memfd (no temp files on disk).
# Called by entrypoint.sh Phase 7.
SCRIPT=$(echo "$ENVIRONMENT" | jq -r '.setupScript // ""')
[ -z "$SCRIPT" ] && exit 0
echo "$SCRIPT" | python3 /home/agent/memfd-exec.py
