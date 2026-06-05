# Agentor — common dev tasks (see CLAUDE.md for the full picture)

compose := "docker compose -f docker-compose.dev.yml"
tests_compose := "docker compose -f docker-compose.tests.yml"

# Testing artifacts the dockerized suite leaves on the host (cache volume + image).
test_volume := "agentor-test-runner-docker"
test_image := "agentor-test-runner:latest"

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

# Wipe the dev platform (stack, managed containers, volumes, network, data dir) — keeps the test cache
prune:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "==> Stopping the dev stack (orchestrator + compose network/volume)"
    {{compose}} down -v --remove-orphans || true
    echo "==> Removing managed containers (traefik + workers)"
    ids=$(docker ps -aq --filter label=agentor.managed || true)
    [ -n "$ids" ] && docker rm -f $ids || echo "    none"
    echo "==> Removing agentor volumes (workspaces, agents, dind, certs, data) — keeping the test cache"
    vols=$(docker volume ls -q --filter name=agentor | grep -vx '{{test_volume}}' || true)
    [ -n "$vols" ] && docker volume rm $vols || echo "    none"
    echo "==> Removing the agentor-net network"
    docker network rm agentor-net 2>/dev/null || echo "    already gone"
    echo "==> Deleting the data directory"
    rm -rf "{{justfile_directory()}}/data"
    echo "==> Done — dev wiped, testing artifacts preserved (run \`just purge\` to remove those too)."

# Wipe EVERYTHING: the dev platform (via prune) plus the dockerized test stack, cache volume, and image
purge: prune
    #!/usr/bin/env bash
    set -euo pipefail
    echo "==> Tearing down the dockerized test stack (containers + network + compose volume)"
    {{tests_compose}} down -v --remove-orphans || true
    echo "==> Removing the test-runner cache volume"
    docker volume rm {{test_volume}} 2>/dev/null || echo "    already gone"
    echo "==> Removing the test-runner image"
    docker image rm {{test_image}} 2>/dev/null || echo "    already gone"
    echo "==> Done — no trace of agentor remains, including tests."
