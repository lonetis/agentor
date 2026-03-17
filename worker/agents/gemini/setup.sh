#!/bin/bash
set -e
source /home/agent/agents/common.sh

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.gemini
sudo chown agent:agent ~/.gemini

# --- Config files (created once, never overwritten) ---

if [ ! -f ~/.gemini/trustedFolders.json ]; then
    echo '{"/workspace":"TRUST_FOLDER"}' > ~/.gemini/trustedFolders.json
    chmod 600 ~/.gemini/trustedFolders.json
fi

if [ ! -f ~/.gemini/settings.json ]; then
    # Detect auth method and write initial settings
    if [ -f ~/.gemini/oauth_creds.json ] && [ "$(wc -c < ~/.gemini/oauth_creds.json)" -gt 3 ]; then
        echo '{"security":{"auth":{"selectedType":"oauth-personal"}}}' > ~/.gemini/settings.json
    elif [ -n "$GEMINI_API_KEY" ]; then
        echo '{"security":{"auth":{"selectedType":"gemini-api-key"}}}' > ~/.gemini/settings.json
    fi
fi

# API key env file — always written (not user-editable config, just passes the key)
if [ -n "$GEMINI_API_KEY" ]; then
    echo "GEMINI_API_KEY=$GEMINI_API_KEY" > ~/.gemini/.env
fi

# --- Platform files (created once, never overwritten) ---

[ -f ~/.gemini/GEMINI.md ] || write_agents_md ~/.gemini/GEMINI.md

if ! ls -d ~/.gemini/commands/agentor-* >/dev/null 2>&1; then
    write_skills_toml ~/.gemini/commands
fi
