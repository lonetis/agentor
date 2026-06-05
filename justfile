# Agentor — common dev tasks (see CLAUDE.md for the full picture)

compose := "docker compose -f docker-compose.dev.yml"

# List available recipes
default:
    @just --list

# Start the dev stack (build + run detached)
up:
    {{compose}} up --build -d

# Stop the dev stack
down:
    {{compose}} down

# Build the worker image locally
build:
    docker build -t agentor-worker:latest ./worker

# Run the isolated dockerized test suite (e.g. `just test api/health.spec.ts` or `just test --project=api`)
test *args:
    cd tests && npm run test:docker -- {{args}}

# Run the full dockerized suite (API + UI)
test-all *args:
    cd tests && npm run test:docker -- {{args}}

# Run the dockerized API tests
test-api *args:
    cd tests && npm run test:docker:api -- {{args}}

# Run the dockerized UI tests
test-ui *args:
    cd tests && npm run test:docker:ui -- {{args}}

# Wipe every trace of the platform: stack, managed containers, volumes, network, data dir
prune:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "==> Stopping the dev stack (orchestrator + compose network/volume)"
    {{compose}} down -v --remove-orphans || true
    echo "==> Removing managed containers (traefik + workers)"
    ids=$(docker ps -aq --filter label=agentor.managed || true)
    [ -n "$ids" ] && docker rm -f $ids || echo "    none"
    echo "==> Removing agentor volumes (workspaces, agents, dind, certs, data)"
    vols=$(docker volume ls -q --filter name=agentor || true)
    [ -n "$vols" ] && docker volume rm $vols || echo "    none"
    echo "==> Removing the agentor-net network"
    docker network rm agentor-net 2>/dev/null || echo "    already gone"
    echo "==> Deleting the data directory"
    rm -rf "{{justfile_directory()}}/data"
    echo "==> Done — no trace of agentor remains."
