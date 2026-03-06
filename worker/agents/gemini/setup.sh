#!/bin/bash
set -e

# --- Directory + ownership (runs every restart) ---
mkdir -p ~/.gemini
# Docker may create this dir as root when bind-mounting credential files
sudo chown agent:agent ~/.gemini

# --- Auth + settings (runs every restart) ---
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

# --- Platform files (first startup only) ---
SENTINEL="/home/agent/.agentor-platform-init"
[ -f "$SENTINEL" ] && exit 0

# AGENTS.md → ~/.gemini/GEMINI.md
if [ -n "$AGENTS_MD" ]; then
    ENTRY_COUNT=$(echo "$AGENTS_MD" | jq -r 'length' 2>/dev/null || echo 0)
    if [ "$ENTRY_COUNT" -gt 0 ]; then
        MERGED=""
        for i in $(seq 0 $((ENTRY_COUNT - 1))); do
            NAME=$(echo "$AGENTS_MD" | jq -r ".[$i].name")
            CONTENT=$(echo "$AGENTS_MD" | jq -r ".[$i].content")
            [ -n "$MERGED" ] && MERGED="${MERGED}

---

"
            MERGED="${MERGED}# ${NAME}

${CONTENT}"
        done
        if [ -f ~/.gemini/GEMINI.md ]; then
            printf '\n\n%s' "$MERGED" >> ~/.gemini/GEMINI.md
        else
            echo "$MERGED" > ~/.gemini/GEMINI.md
        fi
    fi
fi

# Skills → ~/.gemini/commands/agentor-<name>.toml
if [ -n "$SKILLS" ]; then
    SKILL_COUNT=$(echo "$SKILLS" | jq -r 'length' 2>/dev/null || echo 0)
    for i in $(seq 0 $((SKILL_COUNT - 1))); do
        SKILL_NAME=$(echo "$SKILLS" | jq -r ".[$i].name")
        SKILL_CONTENT=$(echo "$SKILLS" | jq -r ".[$i].content")
        SAFE_NAME=$(echo "$SKILL_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
        # Strip YAML frontmatter for Gemini TOML format
        BODY_CONTENT=$(echo "$SKILL_CONTENT" | sed -n '/^---$/,/^---$/!p' | sed '/./,$!d')
        mkdir -p ~/.gemini/commands
        ESCAPED_BODY=$(echo "$BODY_CONTENT" | sed 's/\\/\\\\/g')
        cat > "$HOME/.gemini/commands/agentor-${SAFE_NAME}.toml" <<TOMLEOF
description = "${SKILL_NAME}"
prompt = """
${ESCAPED_BODY}
"""
TOMLEOF
    done
fi
