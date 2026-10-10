#!/bin/bash
set -euo pipefail
source /home/agent/agents/common.sh

mkdir -p ~/.config/opencode ~/.local/share/opencode ~/.local/state/opencode
mkdir -p ~/.config/opencode/plugins
rm -f ~/.config/opencode/plugins/agentor-zen-console.js
cat > ~/.config/opencode/plugins/agentor-zen-console.js <<'PLUGIN'
import plugin from '/home/agent/agents/opencode/zen-console.mjs';
export default plugin;
PLUGIN

# Respect both supported config formats. The user owns these files after the
# first boot, including any additional providers or model preferences.
if [ ! -f ~/.config/opencode/opencode.json ] && [ ! -f ~/.config/opencode/opencode.jsonc ]; then
    jq -n '{
        "$schema": "https://opencode.ai/config.json",
        update: "disable",
        providers: {zen: {name: "OpenCode Console (Zen)", env: ["OPENCODE_ZEN_API_KEY"]}},
        permissions: [{action: "*", resource: "*", effect: "allow"}],
        mcp: {
            servers: {
                playwright: {type: "local", command: ["npx", "-y", "@playwright/mcp@latest"]},
                "chrome-devtools": {type: "local", command: ["npx", "-y", "chrome-devtools-mcp@latest"]}
            }
        }
    }' > ~/.config/opencode/opencode.json
fi

[ -f ~/.config/opencode/AGENTS.md ] || write_instructions ~/.config/opencode/AGENTS.md

# OpenCode discovers the shared skills tree used by Codex. Do not generate a
# third copy of Agentor skills in its native config directory.
if ! ls -d ~/.agents/skills/agentor-* >/dev/null 2>&1; then
    write_capabilities_md ~/.agents/skills
fi
