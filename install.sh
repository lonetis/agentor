#!/bin/bash
set -e

REPO="lonetis/agentor"
BRANCH="main"
BASE="https://raw.githubusercontent.com/$REPO/$BRANCH"

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
    BOLD='\033[1m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    CYAN='\033[0;36m'
    RESET='\033[0m'
else
    BOLD='' GREEN='' YELLOW='' CYAN='' RESET=''
fi

# Use /dev/tty for prompts so it works even when piped (curl | bash)
INTERACTIVE=true
if ! exec 3</dev/tty 2>/dev/null; then
    INTERACTIVE=false
else
    exec 3<&-
fi

# Temp directory for downloads, cleaned up on exit
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# sync_file <url> <local_path>
# Downloads upstream file and syncs it with the local copy.
# Fresh install: downloads directly. Update: shows diff and prompts.
sync_file() {
    local url="$1"
    local local_path="$2"
    local tmp_file="$TMPDIR/$(basename "$local_path")-$$-$RANDOM"

    # Fresh install — file doesn't exist yet
    if [ ! -f "$local_path" ]; then
        echo -e "${GREEN}Downloading${RESET} $local_path ..."
        curl -fsSL "$url" -o "$local_path"
        return
    fi

    # File exists — download upstream to temp and compare
    curl -fsSL "$url" -o "$tmp_file"

    if diff -q "$local_path" "$tmp_file" > /dev/null 2>&1; then
        echo -e "${CYAN}Up to date${RESET}  $local_path"
        return
    fi

    # Files differ
    if [ "$INTERACTIVE" = false ]; then
        echo -e "${YELLOW}Changed${RESET}    $local_path (non-interactive, skipping)"
        return
    fi

    echo ""
    echo -e "${BOLD}$local_path has upstream changes:${RESET}"
    diff --color=auto -u \
        --label "current: $local_path" \
        --label "upstream: $local_path" \
        "$local_path" "$tmp_file" || true

    while true; do
        echo ""
        echo -e "  ${BOLD}o${RESET}) Keep old (discard upstream changes)"
        echo -e "  ${BOLD}n${RESET}) Use new (overwrite with upstream)"
        echo -e "  ${BOLD}m${RESET}) Merge (open in \$EDITOR)"
        echo -e "  ${BOLD}d${RESET}) Show diff again"
        echo -n "Choice [o/n/m/d]: "
        read -r choice </dev/tty

        case "$choice" in
            o|O)
                echo -e "${CYAN}Kept${RESET}       $local_path (no changes)"
                return
                ;;
            n|N)
                cp "$tmp_file" "$local_path"
                echo -e "${GREEN}Updated${RESET}    $local_path"
                return
                ;;
            m|M)
                cp "$local_path" "$local_path.bak"
                cp "$tmp_file" "$local_path"
                ${EDITOR:-vi} "$local_path" </dev/tty
                echo -e "${GREEN}Merged${RESET}     $local_path (backup at $local_path.bak)"
                return
                ;;
            d|D)
                echo ""
                diff --color=auto -u \
                    --label "current: $local_path" \
                    --label "upstream: $local_path" \
                    "$local_path" "$tmp_file" || true
                ;;
            *)
                echo "Invalid choice. Enter o, n, m, or d."
                ;;
        esac
    done
}

echo "Agentor — Install / Update"
echo "=========================="
echo ""

sync_file "$BASE/docker-compose.prod.yml" "docker-compose.yml"
sync_file "$BASE/.env.example"            ".env"

mkdir -p .cred
sync_file "$BASE/.cred.example/claude.json"  ".cred/claude.json"
sync_file "$BASE/.cred.example/codex.json"   ".cred/codex.json"
sync_file "$BASE/.cred.example/gemini.json"  ".cred/gemini.json"

echo ""
echo "Done! Next steps:"
echo "  1. Edit .env with your API keys (for OAuth, log in inside a worker — see .cred/README)"
echo "  2. docker compose up -d"
echo "  3. Open http://localhost:3000"
