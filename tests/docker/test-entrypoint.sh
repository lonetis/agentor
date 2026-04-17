#!/usr/bin/env bash
# Test runner entrypoint.
#
# Boots an isolated agentor stack inside this container's own dockerd
# (true DinD), runs the playwright suite against it, and tears it down.
# Forwards every CLI arg straight to `playwright test`, so the user can
# run all tests, a single file, or pass --project=api, etc.
set -euo pipefail

log() { echo -e "\033[1;36m[test-runner]\033[0m $*"; }
err() { echo -e "\033[1;31m[test-runner]\033[0m $*" >&2; }

# ---------------------------------------------------------------------------
# Phase 0: cgroup v2 nesting
#
# When this container starts, the runner process is in the parent cgroup
# (e.g. /sys/fs/cgroup/docker). cgroupv2 forbids nested cgroup creation
# in a "domain" cgroup that has live processes — child cgroups created by
# the inner dockerd would inherit "domain threaded" mode, and any attempt
# to apply controllers (Memory, CpuQuota, etc.) on grandchild containers
# fails with: "cannot enter cgroupv2 ... with domain controllers — it is
# in threaded mode". This is the well-known DinD cgroupv2 issue and is
# fixed by moving every process out of the root group into a child
# `init` group, then enabling controllers on the now-empty parent.
# Same trick the official `docker:dind` image uses.
# ---------------------------------------------------------------------------
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
    log "Setting up cgroup v2 nesting..."
    mkdir -p /sys/fs/cgroup/init
    xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
    sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
        > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || \
        log "Warning: could not enable cgroup controllers (may be restricted by parent)."
fi

# ---------------------------------------------------------------------------
# Phase 0.5: dnsmasq + resolver fix (must run BEFORE dockerd starts)
#
# Problem: Node.js's c-ares resolver does NOT honour RFC 6761's special
# handling for `.localhost`, so without help `dash.docker.localhost`
# fails ENOTFOUND in Playwright's request context. We need a local
# resolver that wildcard-maps everything under `.localhost` to 127.0.0.1
# (also covers the random per-test subdomains the domain-mapping tests
# create on the fly), AND that forwards every other query through to a
# resolver that actually works in this environment.
#
# Docker Desktop blocks direct outbound to public DNS (8.8.8.8 etc.) —
# only the gateway resolver (127.0.0.11 / 192.168.65.7) is reachable.
# So we MUST use that as the upstream, not a public resolver, otherwise
# every query that isn't `.localhost` fails (which breaks BuildKit when
# it tries to pull images).
#
# We snapshot the original /etc/resolv.conf BEFORE replacing it, then
# point dnsmasq at it via `resolv-file=` so future changes to Docker's
# embedded resolver are picked up automatically.
# ---------------------------------------------------------------------------
log "Starting dnsmasq for *.localhost resolution..."
# Snapshot ONLY the nameserver lines from the original resolv.conf —
# dnsmasq's `resolv-file=` reads any `nameserver` lines as upstreams.
# Whatever Docker handed us (127.0.0.11 in compose mode, the gateway IP
# in plain `docker run` mode) is the only resolver we know works in
# this network namespace; public DNS like 8.8.8.8 is unreachable from
# inside the test-runner because Docker Desktop blocks direct outbound.
grep '^nameserver ' /etc/resolv.conf > /etc/resolv.conf.upstream
cat > /etc/dnsmasq.conf <<'EOF'
# Wildcard answer for everything under .localhost
address=/localhost/127.0.0.1
listen-address=127.0.0.1
bind-interfaces
no-poll
# Read upstream nameservers from the snapshot. NOTE: do NOT also set
# `no-resolv` — they're mutually exclusive and `no-resolv` silently
# wins, leaving dnsmasq with zero upstreams and refusing every query.
resolv-file=/etc/resolv.conf.upstream
# Strip AAAA records — the test-runner has no IPv6 path to the internet,
# and dockerd's HTTP client picks IPv6 first when both are present, so
# leaving AAAA in causes 30s+ TLS handshake timeouts on every pull.
filter-AAAA
EOF
dnsmasq --conf-file=/etc/dnsmasq.conf
echo "nameserver 127.0.0.1" > /etc/resolv.conf
if ! getent hosts dash.docker.localhost > /dev/null 2>&1; then
    err "dnsmasq failed to resolve dash.docker.localhost"
    cat /etc/resolv.conf >&2
    exit 1
fi
if ! getent hosts registry-1.docker.io > /dev/null 2>&1; then
    err "dnsmasq forwarding to upstream failed (registry-1.docker.io)"
    cat /etc/resolv.conf.upstream >&2
    exit 1
fi
log "dnsmasq ready (*.localhost → 127.0.0.1, upstream → $(cat /etc/resolv.conf.upstream | tr '\n' ' '))"

# ---------------------------------------------------------------------------
# Phase 1: start inner dockerd
#
# dockerd starts AFTER /etc/resolv.conf has been redirected to dnsmasq,
# so its image pulls go through dnsmasq → upstream and resolve correctly.
# We DO NOT pass --dns flags — dockerd auto-detects the loopback nameserver
# in /etc/resolv.conf and substitutes a Docker-managed resolver for child
# containers, which is exactly what we want.
# ---------------------------------------------------------------------------
log "Starting inner dockerd..."
mkdir -p /var/lib/docker /etc/docker
# Clean stale state from a previous run on the same persistent volume.
find /run /var/run -iname 'docker*.pid' -delete 2>/dev/null || true
rm -f /var/run/docker.sock 2>/dev/null || true

dockerd > /var/log/dockerd.log 2>&1 &
DOCKERD_PID=$!

# Wait up to 30s for the socket to appear.
for _ in $(seq 1 300); do
    [ -S /var/run/docker.sock ] && break
    sleep 0.1
done
if [ ! -S /var/run/docker.sock ]; then
    err "dockerd failed to start within 30s. Last 50 lines of log:"
    tail -n 50 /var/log/dockerd.log >&2 || true
    exit 1
fi
log "Inner dockerd ready (pid $DOCKERD_PID)."

# ---------------------------------------------------------------------------
# Phase 1.5: wipe stale state from previous runs.
#
# We keep the persistent /var/lib/docker volume so image builds stay
# cached (huge win). But containers, the agentor-data volume, and any
# stale labelled mappings would otherwise leak between runs. Order
# matters: bring down the compose project FIRST so its volumes/networks
# are properly recreated, then sweep up any orphan worker containers
# the orchestrator spawned via dockerode (those are NOT part of the
# compose project).
#
# We deliberately DO NOT run `docker network/volume prune` here —
# that breaks BuildKit's internal state on the next build.
# ---------------------------------------------------------------------------
log "Cleaning stale state (keeping images for build cache)..."
docker compose -f /opt/test-stack/stack.yml -p agentor-test down -v --remove-orphans > /dev/null 2>&1 || true
# Sweep up any orchestrator-spawned workers that aren't part of the compose
# project — they have label `agentor.managed=true`.
docker ps -aq --filter "label=agentor.managed" | xargs -r docker rm -f > /dev/null 2>&1 || true
# Also remove the Traefik container (label value "traefik")
docker ps -aq --filter "label=agentor.managed=traefik" | xargs -r docker rm -f > /dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Phase 2: build agentor images inside inner dockerd
# Cached on the persistent /var/lib/docker volume — fast on subsequent runs.
# ---------------------------------------------------------------------------
log "Building agentor images (cached after first run)..."

# Retry wrapper — first builds need to pull base images from docker.io,
# and the inner-DinD network path to that registry can be slow enough to
# trip dockerd's TLS handshake timeout (20s+ has been observed). On the
# subsequent retry, BuildKit usually picks up from where it left off.
build_with_retry() {
    local img=$1
    local ctx=$2
    local attempt
    for attempt in 1 2 3 4; do
        if docker build -t "$img" "$ctx"; then
            return 0
        fi
        log "Build of $img failed (attempt $attempt/4) — retrying in 5s..."
        sleep 5
    done
    err "Build of $img failed after 4 attempts"
    return 1
}

build_with_retry agentor-worker:latest /src/worker
build_with_retry agentor-orchestrator:latest /src/orchestrator
log "Images built."

# ---------------------------------------------------------------------------
# Phase 3: bring inner stack up fresh
# ---------------------------------------------------------------------------
log "Pre-cleaning stale playwright state on host bind mount..."
rm -rf /work/tests/.auth /work/tests/test-results /work/tests/playwright-report 2>/dev/null || true

log "Starting inner agentor stack..."
docker compose -f /opt/test-stack/stack.yml -p agentor-test up -d

# ---------------------------------------------------------------------------
# Phase 4: wait for orchestrator (via traefik on https://dash.docker.localhost)
# Traefik publishes 80/443 to the test-runner network namespace; *.localhost
# now resolves to 127.0.0.1 for both libc and c-ares.
# ---------------------------------------------------------------------------
log "Waiting for https://dash.docker.localhost/api/health ..."
READY=0
for i in $(seq 1 180); do
    if curl -fsk --max-time 2 https://dash.docker.localhost/api/health > /dev/null 2>&1; then
        READY=1
        log "Orchestrator ready after ${i}s."
        break
    fi
    sleep 1
done
if [ "$READY" != "1" ]; then
    err "Orchestrator did not become ready within 180s. Stack logs:"
    docker compose -f /opt/test-stack/stack.yml -p agentor-test logs --tail 200 >&2 || true
    docker compose -f /opt/test-stack/stack.yml -p agentor-test down -v --remove-orphans 2>/dev/null || true
    exit 1
fi

# ---------------------------------------------------------------------------
# Phase 5: run playwright tests
# ---------------------------------------------------------------------------
cd /work/tests
if [ ! -d node_modules ]; then
    log "Installing test dependencies..."
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund
fi

log "Running playwright tests: $*"
set +e
npx playwright test "$@"
EXIT=$?
set -e

# ---------------------------------------------------------------------------
# Phase 6: tear down inner stack (always, unless DEBUG_KEEP_ALIVE)
# ---------------------------------------------------------------------------
if [ "${DEBUG_KEEP_ALIVE:-0}" = "1" ]; then
    log "DEBUG_KEEP_ALIVE=1 — keeping inner stack alive. Press Ctrl+C to exit."
    log "Use \`docker compose -f docker-compose.tests.yml exec test-runner bash\` from another terminal to inspect."
    tail -f /dev/null
fi

log "Tearing down inner agentor stack..."
docker compose -f /opt/test-stack/stack.yml -p agentor-test down -v --remove-orphans 2>/dev/null || true

log "Done. Exit code: $EXIT"
exit $EXIT
