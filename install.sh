#!/bin/bash
set -e

REPO="lonetis/agentor"
BRANCH="main"
BASE="https://raw.githubusercontent.com/$REPO/$BRANCH"

echo "Agentor — Quick Start Setup"
echo "============================"
echo ""

# Download docker-compose.prod.yml as docker-compose.yml
echo "Downloading docker-compose.yml ..."
curl -fsSL "$BASE/docker-compose.prod.yml" -o docker-compose.yml

# Download .env.example as .env (only if .env does not exist)
if [ -f .env ]; then
    echo "Skipping .env (already exists)"
else
    echo "Downloading .env ..."
    curl -fsSL "$BASE/.env.example" -o .env
fi

# Download .cred/ directory (skip existing files)
mkdir -p .cred
for file in README claude.json codex.json gemini.json; do
    if [ -f ".cred/$file" ]; then
        echo "Skipping .cred/$file (already exists)"
    else
        echo "Downloading .cred/$file ..."
        curl -fsSL "$BASE/.cred.example/$file" -o ".cred/$file"
    fi
done

echo ""
echo "Done! Next steps:"
echo "  1. Edit .env and .cred/ files with your API keys / credentials"
echo "  2. docker compose up -d"
echo "  3. Open http://localhost:3000"
