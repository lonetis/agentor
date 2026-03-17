#!/bin/bash
set -e
source /home/agent/agents/common.sh

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.gemini
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.gemini

# --- Auth + settings (runs every restart, merges with existing) ---
# Merge trusted folders (preserve user trust decisions)
TRUST_FILE=~/.gemini/trustedFolders.json
if [ -f "$TRUST_FILE" ] && [ -s "$TRUST_FILE" ]; then
    jq '."/workspace" = "TRUST_FOLDER"' "$TRUST_FILE" > "$TRUST_FILE.tmp" && mv "$TRUST_FILE.tmp" "$TRUST_FILE"
else
    echo '{"/workspace":"TRUST_FOLDER"}' > "$TRUST_FILE"
fi
chmod 600 "$TRUST_FILE"

# OAuth credentials are bind-mounted at ~/.gemini/oauth_creds.json
# (shared across all workers via .cred/gemini.json on the host)
# If the file has real content (not just {}), select oauth-personal auth method.
if [ -f ~/.gemini/oauth_creds.json ] && [ "$(wc -c < ~/.gemini/oauth_creds.json)" -gt 3 ]; then
    SETTINGS_FILE=~/.gemini/settings.json
    if [ -f "$SETTINGS_FILE" ] && [ -s "$SETTINGS_FILE" ]; then
        jq '.security.auth.selectedType = "oauth-personal"' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
    else
        echo '{"security":{"auth":{"selectedType":"oauth-personal"}}}' > "$SETTINGS_FILE"
    fi
fi

# API key auth — write to ~/.gemini/.env so the CLI auto-loads it
# without interactive prompts (headless-safe)
if [ -n "$GEMINI_API_KEY" ] && { [ ! -f ~/.gemini/oauth_creds.json ] || [ "$(wc -c < ~/.gemini/oauth_creds.json)" -le 3 ]; }; then
    echo "GEMINI_API_KEY=$GEMINI_API_KEY" > ~/.gemini/.env
    SETTINGS_FILE=~/.gemini/settings.json
    if [ -f "$SETTINGS_FILE" ] && [ -s "$SETTINGS_FILE" ]; then
        jq '.security.auth.selectedType = "gemini-api-key"' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
    else
        echo '{"security":{"auth":{"selectedType":"gemini-api-key"}}}' > "$SETTINGS_FILE"
    fi
fi

# --- Platform files (first startup only) ---
SENTINEL="/home/agent/.agentor-platform-init"
[ -f "$SENTINEL" ] && exit 0

write_agents_md ~/.gemini/GEMINI.md
write_skills_toml ~/.gemini/commands
