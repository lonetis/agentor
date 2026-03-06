#!/bin/bash
set -e

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.claude
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.claude

# --- Auth + settings (runs every restart) ---
# OAuth credentials are bind-mounted at ~/.claude/.credentials.json
# (shared across all workers via .cred/claude.json on the host)

# Skip onboarding and dangerous-mode permission prompt
cat > ~/.claude/settings.json <<EOF
{
  "skipDangerousModePermissionPrompt": true
}
EOF
cat > ~/.claude.json <<EOF
{
  "hasCompletedOnboarding": true,
  "effortCalloutDismissed": true,
  "projects": {
    "/workspace": {
      "hasTrustDialogAccepted": true
    }
  }
}
EOF

# --- Platform files (first startup only) ---
SENTINEL="/home/agent/.agentor-platform-init"
[ -f "$SENTINEL" ] && exit 0

# AGENTS.md → ~/.claude/CLAUDE.md
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
        if [ -f ~/.claude/CLAUDE.md ]; then
            printf '\n\n%s' "$MERGED" >> ~/.claude/CLAUDE.md
        else
            echo "$MERGED" > ~/.claude/CLAUDE.md
        fi
    fi
fi

# Skills → ~/.claude/skills/agentor-<name>/SKILL.md
if [ -n "$SKILLS" ]; then
    SKILL_COUNT=$(echo "$SKILLS" | jq -r 'length' 2>/dev/null || echo 0)
    for i in $(seq 0 $((SKILL_COUNT - 1))); do
        SKILL_NAME=$(echo "$SKILLS" | jq -r ".[$i].name")
        SKILL_CONTENT=$(echo "$SKILLS" | jq -r ".[$i].content")
        SAFE_NAME=$(echo "$SKILL_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
        SKILL_DIR="$HOME/.claude/skills/agentor-${SAFE_NAME}"
        mkdir -p "$SKILL_DIR"
        echo "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
    done
fi
