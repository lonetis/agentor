#!/bin/bash
set -e
source /home/agent/agents/common.sh

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.codex
sudo chown agent:agent ~/.codex

# --- Config files (created once, never overwritten) ---

if [ ! -f ~/.codex/config.toml ]; then
    cat > ~/.codex/config.toml <<'EOF'
[projects."/workspace"]
trust_level = "trusted"

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]

[mcp_servers.chrome-devtools]
command = "npx"
args = ["-y", "chrome-devtools-mcp@latest"]
EOF
fi

# --- Platform files (created once, never overwritten) ---

[ -f ~/.codex/AGENTS.md ] || write_agents_md ~/.codex/AGENTS.md

if ! ls -d ~/.agents/skills/agentor-* >/dev/null 2>&1; then
    write_skills_md ~/.agents/skills
fi
