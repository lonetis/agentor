#!/bin/bash
set -e
source /home/agent/agents/common.sh

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.codex
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.codex

# --- Auth + settings (runs every restart, merges with existing) ---
# OAuth credentials are bind-mounted at ~/.codex/auth.json
# (shared across all workers via .cred/codex.json on the host)
# API key auth — OPENAI_API_KEY is read from the environment directly by the CLI

# Ensure /workspace trust config exists (append if missing, preserve existing config)
CONFIG_FILE=~/.codex/config.toml
if [ -f "$CONFIG_FILE" ]; then
    if ! grep -q '^\[projects\."/workspace"\]' "$CONFIG_FILE" 2>/dev/null; then
        printf '\n[projects."/workspace"]\ntrust_level = "trusted"\n' >> "$CONFIG_FILE"
    fi
else
    cat > "$CONFIG_FILE" <<'EOF'
[projects."/workspace"]
trust_level = "trusted"
EOF
fi

# --- Platform files (first startup only) ---
SENTINEL="/home/agent/.agentor-platform-init"
[ -f "$SENTINEL" ] && exit 0

write_agents_md ~/.codex/AGENTS.md
write_skills_md ~/.agents/skills
