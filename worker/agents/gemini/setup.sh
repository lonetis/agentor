#!/bin/bash
set -e

mkdir -p ~/.gemini
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.gemini

# Trust /workspace so the CLI doesn't prompt on startup
cat > ~/.gemini/trustedFolders.json << 'EOF'
{
  "/workspace": "TRUST_FOLDER"
}
EOF
chmod 600 ~/.gemini/trustedFolders.json

# OAuth credentials are bind-mounted at ~/.gemini/oauth_creds.json
# (shared across all workers via .cred/gemini.json on the host)
# If the file has real content (not just {}), select oauth-personal auth method.
if [ -f ~/.gemini/oauth_creds.json ] && [ "$(wc -c < ~/.gemini/oauth_creds.json)" -gt 3 ]; then
    echo '{"security":{"auth":{"selectedType":"oauth-personal"}}}' > ~/.gemini/settings.json
fi

# API key auth — write to ~/.gemini/.env so the CLI auto-loads it
# without interactive prompts (headless-safe)
if [ -n "$GEMINI_API_KEY" ] && { [ ! -f ~/.gemini/oauth_creds.json ] || [ "$(wc -c < ~/.gemini/oauth_creds.json)" -le 3 ]; }; then
    echo "GEMINI_API_KEY=$GEMINI_API_KEY" > ~/.gemini/.env
    echo '{"security":{"auth":{"selectedType":"gemini-api-key"}}}' > ~/.gemini/settings.json
fi
