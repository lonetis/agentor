#!/bin/bash
set -e
source /home/agent/agents/common.sh

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

write_agents_md ~/.claude/CLAUDE.md
write_skills_md ~/.claude/skills
