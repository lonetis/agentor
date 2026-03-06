#!/bin/bash
set -e
source /home/agent/agents/common.sh

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.codex
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.codex

# --- Auth + settings (runs every restart) ---
# OAuth credentials are bind-mounted at ~/.codex/auth.json
# (shared across all workers via .cred/codex.json on the host)
# API key auth — OPENAI_API_KEY is read from the environment directly by the CLI

# Trust /workspace so the CLI doesn't prompt on startup
cat > ~/.codex/config.toml << 'EOF'
[projects."/workspace"]
trust_level = "trusted"
EOF

# --- Platform files (first startup only) ---
SENTINEL="/home/agent/.agentor-platform-init"
[ -f "$SENTINEL" ] && exit 0

write_agents_md ~/.codex/AGENTS.md
write_skills_md ~/.agents/skills
