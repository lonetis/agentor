#!/bin/bash
set -e
source /home/agent/agents/common.sh

# Antigravity CLI (`agy`) keeps everything under ~/.gemini: CLI settings and
# state in ~/.gemini/antigravity-cli/, the config shared with the Antigravity
# app (MCP servers, skills, plugins, hooks) in ~/.gemini/config/.
AGY_CLI_DIR=~/.gemini/antigravity-cli
AGY_CONFIG_DIR=~/.gemini/config
# Without a D-Bus session bus (containers) agy stores its OAuth token in this
# file instead of the OS keyring. The orchestrator bind-mounts the user's
# shared credential file here; `{}` means "not logged in".
AGY_TOKEN_FILE=$AGY_CLI_DIR/antigravity-oauth-token

agy_logged_in() {
    [ -f "$AGY_TOKEN_FILE" ] && [ "$(wc -c < "$AGY_TOKEN_FILE")" -gt 3 ]
}

# --- Directory + ownership (runs every restart) ---
mkdir -p "$AGY_CLI_DIR" "$AGY_CONFIG_DIR"
sudo chown agent:agent ~/.gemini "$AGY_CLI_DIR" "$AGY_CONFIG_DIR"

# --- Config files (created once, never overwritten) ---

if [ ! -f "$AGY_CLI_DIR/settings.json" ]; then
    # API key auth only when the user has NOT logged in via OAuth — a
    # `modelProvider` of "gemini" would take precedence over the OAuth login.
    if [ -n "$GEMINI_API_KEY" ] && ! agy_logged_in; then
        echo '{"trustedWorkspaces":["/workspace"],"modelProvider":"gemini"}' > "$AGY_CLI_DIR/settings.json"
    else
        echo '{"trustedWorkspaces":["/workspace"]}' > "$AGY_CLI_DIR/settings.json"
    fi
fi

# agy refuses to start when `modelProvider` is "gemini" but GEMINI_API_KEY is
# unset (e.g. the key was removed from the account) — fall back to OAuth.
if [ -z "$GEMINI_API_KEY" ] && [ "$(jq -r '.modelProvider // ""' "$AGY_CLI_DIR/settings.json" 2>/dev/null)" = "gemini" ]; then
    jq 'del(.modelProvider)' "$AGY_CLI_DIR/settings.json" > "$AGY_CLI_DIR/settings.json.tmp" \
        && mv "$AGY_CLI_DIR/settings.json.tmp" "$AGY_CLI_DIR/settings.json"
fi

if [ ! -f "$AGY_CONFIG_DIR/mcp_config.json" ]; then
    cat > "$AGY_CONFIG_DIR/mcp_config.json" <<'EOF'
{
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

# agy loads ~/.gemini/GEMINI.md as a global rule (kept from Gemini CLI).
[ -f ~/.gemini/GEMINI.md ] || write_instructions ~/.gemini/GEMINI.md

if ! ls -d "$AGY_CONFIG_DIR"/skills/agentor-* >/dev/null 2>&1; then
    write_capabilities_md "$AGY_CONFIG_DIR/skills"
fi
