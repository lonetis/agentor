#!/bin/bash
set -e

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.codex
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.codex

# --- Auth (runs every restart) ---
# OAuth credentials are bind-mounted at ~/.codex/auth.json
# (shared across all workers via .cred/codex.json on the host)
# API key auth — OPENAI_API_KEY is read from the environment directly by the CLI

# --- Platform files (first startup only) ---
SENTINEL="/home/agent/.agentor-platform-init"
[ -f "$SENTINEL" ] && exit 0

# AGENTS.md → ~/.codex/AGENTS.md
if [ -n "$AGENTS_MD" ]; then
    ENTRY_COUNT=$(echo "$AGENTS_MD" | jq -r 'length' 2>/dev/null || echo 0)
    if [ "$ENTRY_COUNT" -gt 0 ]; then
        MERGED=""
        for i in $(seq 0 $((ENTRY_COUNT - 1))); do
            NAME=$(echo "$AGENTS_MD" | jq -r ".[$i].name")
            CONTENT=$(echo "$AGENTS_MD" | jq -r ".[$i].content")
            [ -n "$MERGED" ] && MERGED="${MERGED}

---

"
            MERGED="${MERGED}# ${NAME}

${CONTENT}"
        done
        mkdir -p ~/.codex
        if [ -f ~/.codex/AGENTS.md ]; then
            printf '\n\n%s' "$MERGED" >> ~/.codex/AGENTS.md
        else
            echo "$MERGED" > ~/.codex/AGENTS.md
        fi
    fi
fi

# Skills → ~/.agents/skills/agentor-<name>/SKILL.md
if [ -n "$SKILLS" ]; then
    SKILL_COUNT=$(echo "$SKILLS" | jq -r 'length' 2>/dev/null || echo 0)
    for i in $(seq 0 $((SKILL_COUNT - 1))); do
        SKILL_NAME=$(echo "$SKILLS" | jq -r ".[$i].name")
        SKILL_CONTENT=$(echo "$SKILLS" | jq -r ".[$i].content")
        SAFE_NAME=$(echo "$SKILL_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
        SKILL_DIR="$HOME/.agents/skills/agentor-${SAFE_NAME}"
        mkdir -p "$SKILL_DIR"
        echo "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
    done
fi
