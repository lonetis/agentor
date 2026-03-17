#!/bin/bash
set -e
source /home/agent/agents/common.sh

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.claude
sudo chown agent:agent ~/.claude

# --- Config files (created once, never overwritten) ---
# All files below are only written if they don't exist yet. Once created,
# the user owns them — changes (MCP servers, hooks, etc.) persist forever.

if [ ! -f ~/.claude/settings.json ]; then
    cat > ~/.claude/settings.json <<'EOF'
{
  "skipDangerousModePermissionPrompt": true,
  "alwaysThinkingEnabled": true,
  "effortLevel": "high",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
EOF
fi

# ~/.claude.json — entrypoint seeds the volume with {} on first creation
# MCP servers go here (user scope — visible in `claude mcp list`)
CLAUDE_JSON=~/.claude.json
if [ ! -f "$CLAUDE_JSON" ] || [ "$(cat "$CLAUDE_JSON" 2>/dev/null)" = "{}" ]; then
    cat > "$CLAUDE_JSON" <<'EOF'
{
  "hasCompletedOnboarding": true,
  "effortCalloutDismissed": true,
  "projects": {
    "/workspace": {
      "hasTrustDialogAccepted": true
    }
  },
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
EOF
fi

# --- Platform files (created once, never overwritten) ---

[ -f ~/.claude/CLAUDE.md ] || write_agents_md ~/.claude/CLAUDE.md

# Skills: check if any agentor skill dir exists
if ! ls -d ~/.claude/skills/agentor-* >/dev/null 2>&1; then
    write_skills_md ~/.claude/skills
fi
