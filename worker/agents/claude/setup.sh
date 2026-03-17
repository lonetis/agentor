#!/bin/bash
set -e
source /home/agent/agents/common.sh

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.claude
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.claude

# --- Auth + settings (runs every restart, merges with existing) ---
# OAuth credentials are bind-mounted at ~/.claude/.credentials.json
# (shared across all workers via .cred/claude.json on the host)

# Merge settings (preserve user additions like hooks, MCP servers, custom env)
SETTINGS_FILE=~/.claude/settings.json
if [ -f "$SETTINGS_FILE" ] && [ -s "$SETTINGS_FILE" ]; then
    jq '.skipDangerousModePermissionPrompt = true |
        .alwaysThinkingEnabled = true |
        .effortLevel = "high" |
        .env = ((.env // {}) + {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}) |
        .permissions.defaultMode = "bypassPermissions"' \
        "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
else
    cat > "$SETTINGS_FILE" <<'EOF'
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

# Merge ~/.claude.json (preserve user MCP servers, custom preferences)
CLAUDE_JSON=~/.claude.json
if [ -f "$CLAUDE_JSON" ] && [ -s "$CLAUDE_JSON" ] && [ "$(cat "$CLAUDE_JSON")" != "{}" ]; then
    jq '.hasCompletedOnboarding = true |
        .effortCalloutDismissed = true |
        .projects["/workspace"].hasTrustDialogAccepted = true' \
        "$CLAUDE_JSON" > "$CLAUDE_JSON.tmp" && mv "$CLAUDE_JSON.tmp" "$CLAUDE_JSON"
else
    cat > "$CLAUDE_JSON" <<'EOF'
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
fi

# --- Platform files (first startup only) ---
SENTINEL="/home/agent/.agentor-platform-init"
[ -f "$SENTINEL" ] && exit 0

write_agents_md ~/.claude/CLAUDE.md
write_skills_md ~/.claude/skills
