#!/bin/bash
set -e

mkdir -p ~/.claude
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.claude

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
