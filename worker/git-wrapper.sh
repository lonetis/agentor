#!/bin/bash
# Process-tree-aware git identity wrapper
# Walks /proc to find which AI agent is the caller and sets the
# git author/committer identity from agents/*/git-identity files.
# Falls back to global git config when no agent is detected (manual use).

if [ -z "$GIT_AUTHOR_NAME" ]; then
    AGENTS_DIR="/home/agent/agents"
    PID=$$
    while [ "$PID" -gt 1 ]; do
        # Read first two null-terminated args from cmdline (pure bash, no forks)
        { IFS= read -r -d '' CMD; IFS= read -r -d '' CMD2; } < "/proc/$PID/cmdline" 2>/dev/null || break

        # Extract basename via parameter expansion
        BASE="${CMD##*/}"

        # Node.js CLIs: the agent name is the second arg (node /path/to/agent.js)
        if [ "$BASE" = "node" ] || [ "$BASE" = "nodejs" ]; then
            BASE="${CMD2##*/}"
            BASE="${BASE%.js}"
        fi

        # Match against known agent identity files
        if [ -f "$AGENTS_DIR/$BASE/git-identity" ]; then
            { read -r GIT_NAME; read -r GIT_EMAIL; } < "$AGENTS_DIR/$BASE/git-identity"
            export GIT_AUTHOR_NAME="$GIT_NAME"
            export GIT_AUTHOR_EMAIL="$GIT_EMAIL"
            export GIT_COMMITTER_NAME="$GIT_NAME"
            export GIT_COMMITTER_EMAIL="$GIT_EMAIL"
            break
        fi

        # Walk to parent (PPID is 4th field in /proc/PID/stat)
        # Use awk to handle comm fields with spaces or closing parens
        PPID_VAL=$(awk '{sub(/^[0-9]+ \(.*\) [A-Za-z] /, ""); print $1}' "/proc/$PID/stat" 2>/dev/null) || break
        [ -n "$PPID_VAL" ] || break
        PID=$PPID_VAL
    done
fi

exec /usr/bin/git "$@"
