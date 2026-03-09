#!/bin/bash
set -e

# --- Timing helpers ---
# Uses millisecond-precision timestamps via /proc/uptime (no external deps)
_ms() {
    local up
    read -r up _ < /proc/uptime
    echo "${up/./}"
}
BOOT_MS=$(_ms)
_elapsed() {
    echo $(( $(_ms) - BOOT_MS ))
}
_log() {
    echo "[+$(_elapsed)ms] $*"
}

# --- Status display (event-based, rendered by loading-screen.sh) ---
# Events are appended to /tmp/worker-events. The loading screen script
# reads this file every frame and renders an animated status display.
STEP_START_MS=0
_boot() {
    echo "BOOT|$(_ms)" > /tmp/worker-events
}
_total() {
    echo "TOTAL|$1" >> /tmp/worker-events
}
_step() {
    STEP_START_MS=$(_ms)
    echo "$1|active|$2" >> /tmp/worker-events
}
_done() {
    local elapsed=$(( $(_ms) - STEP_START_MS ))
    echo "$1|done|$2|$elapsed" >> /tmp/worker-events
}
_skip() {
    echo "$1|skip|$2" >> /tmp/worker-events
}
_warn() {
    local elapsed=$(( $(_ms) - STEP_START_MS ))
    echo "$1|warn|$2|$elapsed" >> /tmp/worker-events
}
_ready() {
    echo "READY|" >> /tmp/worker-events
}

# --- Helper: wait for file/socket to appear ---
wait_for_file() {
    local path="$1" max_tries="${2:-100}"
    local i=0
    while [ ! -e "$path" ] && [ $i -lt $max_tries ]; do
        sleep 0.05
        i=$((i + 1))
    done
}

# --- Helper: wait for a TCP port to start listening ---
wait_for_port() {
    local port="$1" max_tries="${2:-100}"
    local i=0
    while ! netstat -tln 2>/dev/null | grep -q ":${port} " && [ $i -lt $max_tries ]; do
        sleep 0.05
        i=$((i + 1))
    done
    [ $i -lt $max_tries ]
}

# ==========================================================================
# Phase 0: Create tmux session with animated loading screen
# All phases run foreground and sequentially. The loading screen renders
# real-time progress with spinner animation. The pane is replaced with a
# clean shell + init script only after everything is fully ready.
# ==========================================================================
WINDOW_NAME="main"
_boot
_total 9
tmux new-session -d -s main -n "$WINDOW_NAME" -c /workspace \
    "bash /home/agent/loading-screen.sh"
tmux set -g mouse on
tmux set -g status off
tmux set -g extended-keys on
tmux set -s terminal-features 'xterm*:extkeys'
tmux bind-key -n S-Enter send-keys Escape '[13;2u'
tmux set-option -w -t "main:$WINDOW_NAME" automatic-rename off
_log "Tmux: ready"

# ==========================================================================
# Phase 0b: Export env vars from structured JSON payloads
# EXPOSE_* flags are needed by skills at runtime; custom env vars from the
# environment config are exported so they're available in all subsequent phases.
# ==========================================================================
export EXPOSE_PORT_MAPPINGS=$(echo "$ENVIRONMENT" | jq -r 'if .exposeApis.portMappings == null then true else .exposeApis.portMappings end')
export EXPOSE_DOMAIN_MAPPINGS=$(echo "$ENVIRONMENT" | jq -r 'if .exposeApis.domainMappings == null then true else .exposeApis.domainMappings end')
export EXPOSE_USAGE=$(echo "$ENVIRONMENT" | jq -r 'if .exposeApis.usage == null then true else .exposeApis.usage end')
tmux set-environment -g EXPOSE_PORT_MAPPINGS "$EXPOSE_PORT_MAPPINGS"
tmux set-environment -g EXPOSE_DOMAIN_MAPPINGS "$EXPOSE_DOMAIN_MAPPINGS"
tmux set-environment -g EXPOSE_USAGE "$EXPOSE_USAGE"

# Export custom env vars from ENVIRONMENT.envVars
ENV_VARS=$(echo "$ENVIRONMENT" | jq -r '.envVars // ""')
while IFS= read -r line; do
    trimmed=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
    [[ "$trimmed" == *=* ]] && export "$trimmed" && tmux set-environment -g "${trimmed%%=*}" "${trimmed#*=}"
done <<< "$ENV_VARS"

# ==========================================================================
# Phase 1: Agent setup
# All setup scripts configure auth credentials, CLI settings, and platform
# files (skills, AGENTS.md) — each agent handles its own paths/formats.
# ==========================================================================
_step agents "Agent setup"
_log "Agent setup: start"
for setup_script in /home/agent/agents/*/setup.sh; do
    if [ -x "$setup_script" ]; then
        AGENT_NAME=$(basename "$(dirname "$setup_script")")
        "$setup_script" || echo "[agent] Warning: $AGENT_NAME setup failed, continuing"
    fi
done

# Touch sentinel after all agent scripts have run (they check it internally)
PLATFORM_SENTINEL="/home/agent/.agentor-platform-init"
if [ ! -f "$PLATFORM_SENTINEL" ]; then
    touch "$PLATFORM_SENTINEL"
    _log "Platform setup: sentinel created"
fi

_done agents "Agent setup"
_log "Agent setup: done"

# ==========================================================================
# Phase 2: Docker daemon (DinD, opt-in)
# ==========================================================================
DOCKER_ENABLED=$(echo "$ENVIRONMENT" | jq -r '.dockerEnabled // false')
if [ "$DOCKER_ENABLED" = "true" ]; then
    _step docker "Docker daemon"
    _log "DinD: starting dockerd..."
    sudo find /run /var/run -iname 'docker*.pid' -delete 2>/dev/null || true
    sudo find /run /var/run -path '*/containerd*' -delete 2>/dev/null || true
    sudo rm -rf /var/run/docker /var/run/docker.sock 2>/dev/null || true
    sudo mkdir -p /var/lib/docker /etc/docker
    sudo tee /etc/docker/daemon.json > /dev/null <<'DOCKERCONF'
{
    "storage-driver": "overlay2",
    "iptables": true,
    "ip-forward": true,
    "log-driver": "json-file",
    "log-opts": { "max-size": "10m", "max-file": "3" }
}
DOCKERCONF
    sudo dockerd > /tmp/dockerd.log 2>&1 &
    tries=300
    while [ ! -S /var/run/docker.sock ] && [ $tries -gt 0 ]; do
        sleep 0.1
        tries=$((tries - 1))
    done
    if [ -S /var/run/docker.sock ]; then
        if [ -n "$GITHUB_TOKEN" ]; then
            echo "$GITHUB_TOKEN" | docker login ghcr.io -u agent --password-stdin > /dev/null 2>&1 \
                || echo "[docker] Warning: GHCR login failed, continuing"
        fi
        _done docker "Docker daemon"
        _log "DinD: dockerd ready"
    else
        _warn docker "Docker daemon (failed to start)"
        _log "DinD: WARNING — dockerd failed to start within 30s"
    fi
else
    _skip docker "Docker daemon"
fi

# ==========================================================================
# Phase 3: Display stack (Xvfb + fluxbox + x11vnc + noVNC)
# ==========================================================================
_step display "Display stack"
_log "Display: starting..."
# Clean stale state from previous container runs (lock files persist across restarts)
sudo rm -f /tmp/.X99-lock
sudo rm -rf /tmp/.X11-unix
sudo mkdir -p /tmp/.X11-unix && sudo chmod 1777 /tmp/.X11-unix
pkill -f Xvfb 2>/dev/null || true
pkill -f x11vnc 2>/dev/null || true
pkill -f fluxbox 2>/dev/null || true
pkill -f websockify 2>/dev/null || true
Xvfb :99 -screen 0 1920x1080x24 -ac &
wait_for_file /tmp/.X11-unix/X99
fluxbox &
x11vnc -display :99 -nopw -shared -forever -rfbport 5900 &
wait_for_port 5900
websockify --web /usr/share/novnc/ 6080 localhost:5900 &
_done display "Display stack"
_log "Display: ready"

# ==========================================================================
# Phase 3b: Code editor (code-server)
# ==========================================================================
_step editor "Code editor"
_log "Code-server: starting..."
code-server --auth none --bind-addr 0.0.0.0:8443 --disable-telemetry /workspace > /tmp/code-server.log 2>&1 &
wait_for_port 8443
_done editor "Code editor"
_log "Code-server: ready"

# ==========================================================================
# Phase 4: Git auth
# Runs with full network before the firewall activates.
# ==========================================================================
if [ -n "$GITHUB_TOKEN" ]; then
    _step git "Git authentication"
    _log "Git auth: start"
    export GH_TOKEN="$GITHUB_TOKEN"
    git config --global credential.https://github.com.helper '!gh auth git-credential'
    git config --global url."https://github.com/".insteadOf "git@github.com:"
    _done git "Git authentication"
    _log "Git auth: done"
else
    _skip git "Git authentication"
fi

# ==========================================================================
# Phase 5: Clone repos (parallel per repo, wait for all)
# ==========================================================================
clone_repo() {
    local PROVIDER="$1"
    local URL="$2"
    local BRANCH="$3"
    local REPO_NAME
    REPO_NAME=$(basename "$URL" .git)

    if [ -d "/workspace/$REPO_NAME" ]; then
        echo "Directory /workspace/$REPO_NAME already exists, skipping clone"
        return
    fi

    local CLONE_ARGS=()
    if [ -n "$BRANCH" ]; then
        CLONE_ARGS+=("--branch" "$BRANCH")
    fi

    case "$PROVIDER" in
        github)
            gh repo clone "$URL" "/workspace/$REPO_NAME" -- "${CLONE_ARGS[@]}" 2>&1 || {
                echo "Failed to clone $URL via gh, skipping"
            }
            ;;
        *)
            git clone "${CLONE_ARGS[@]}" "$URL" "/workspace/$REPO_NAME" 2>&1 || {
                echo "Failed to clone $URL, skipping"
            }
            ;;
    esac
}

REPOS_JSON=$(echo "$WORKER" | jq -r '.repos // empty')
if [ -n "$REPOS_JSON" ] && [ "$REPOS_JSON" != "null" ] && [ "$(echo "$REPOS_JSON" | jq 'length')" -gt 0 ]; then
    _step repos "Cloning repositories"
    _log "Repo clone: start"
    CLONE_PIDS=()
    CLONE_URLS=()
    REPO_COUNT=0
    while IFS= read -r repo; do
        PROVIDER=$(echo "$repo" | jq -r '.provider // "github"')
        URL=$(echo "$repo" | jq -r '.url')
        BRANCH=$(echo "$repo" | jq -r '.branch // empty')
        clone_repo "$PROVIDER" "$URL" "$BRANCH" &
        CLONE_PIDS+=($!)
        CLONE_URLS+=("$URL")
        REPO_COUNT=$((REPO_COUNT + 1))
    done < <(echo "$REPOS_JSON" | jq -c '.[]')
    FAILED_REPOS=()
    for i in "${!CLONE_PIDS[@]}"; do
        if ! wait "${CLONE_PIDS[$i]}" 2>/dev/null; then
            FAILED_REPOS+=("${CLONE_URLS[$i]}")
        fi
    done
    if [ ${#FAILED_REPOS[@]} -gt 0 ]; then
        _warn repos "Cloned $REPO_COUNT repositories (${#FAILED_REPOS[@]} failed)"
        for failed_url in "${FAILED_REPOS[@]}"; do
            _log "Repo clone: FAILED — $failed_url"
        done
    else
        _done repos "Cloned $REPO_COUNT repositories"
    fi
    _log "Repo clone: done"
else
    _skip repos "Repository clone"
fi

# ==========================================================================
# Phase 6: Network Firewall (dnsmasq + ipset + iptables)
# Activates after all network operations are done.
# ==========================================================================
FIREWALL_MODE=$(echo "$ENVIRONMENT" | jq -r '.networkMode // "full"')

if [ "$FIREWALL_MODE" != "full" ]; then
    _step firewall "Network firewall"
    _log "Firewall: start ($FIREWALL_MODE)"

    sudo iptables -P OUTPUT DROP
    sudo iptables -A OUTPUT -o lo -j ACCEPT
    sudo iptables -A OUTPUT -d 172.16.0.0/12 -j ACCEPT
    sudo iptables -A OUTPUT -d 10.0.0.0/8 -j ACCEPT
    sudo iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT
    sudo iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

    ALLOWED_DOMAINS=$(echo "$ENVIRONMENT" | jq -r '.allowedDomains // empty')

    if [ "$FIREWALL_MODE" = "block-all" ]; then
        _done firewall "Network firewall (block-all)"
        _log "Firewall: block-all — all outbound blocked"
    elif [ "$FIREWALL_MODE" = "block" ] && { [ -z "$ALLOWED_DOMAINS" ] || [ "$ALLOWED_DOMAINS" = "null" ] || [ "$(echo "$ALLOWED_DOMAINS" | jq 'length')" -eq 0 ]; }; then
        _done firewall "Network firewall (block)"
        _log "Firewall: block — all outbound blocked"
    else
        sudo ipset create allowed_ips hash:ip timeout 0 2>/dev/null || true

        DNSMASQ_CONF="/etc/dnsmasq.d/firewall.conf"
        sudo mkdir -p /etc/dnsmasq.d

        sudo tee "$DNSMASQ_CONF" > /dev/null <<'DNSCONF'
# Agentor network firewall — DNS-based filtering
no-resolv
listen-address=127.0.0.53
bind-interfaces
# Forward all DNS to Docker's internal DNS resolver
server=127.0.0.11
DNSCONF

        if [ -n "$ALLOWED_DOMAINS" ] && [ "$ALLOWED_DOMAINS" != "null" ]; then
            while IFS= read -r domain; do
                domain=$(echo "$domain" | sed 's/^\*\././')
                echo "ipset=/${domain}/allowed_ips" | sudo tee -a "$DNSMASQ_CONF" > /dev/null
            done < <(echo "$ALLOWED_DOMAINS" | jq -r '.[]')
        fi

        sudo systemctl stop dnsmasq 2>/dev/null || sudo killall dnsmasq 2>/dev/null || true
        sudo dnsmasq --conf-dir=/etc/dnsmasq.d --no-daemon --log-facility=/dev/null &
        wait_for_port 53

        echo "nameserver 127.0.0.53" | sudo tee /etc/resolv.conf > /dev/null
        sudo iptables -A OUTPUT -m set --match-set allowed_ips dst -j ACCEPT

        DOMAIN_COUNT=$(echo "$ALLOWED_DOMAINS" | jq -r 'length' 2>/dev/null || echo 0)
        _done firewall "Network firewall ($DOMAIN_COUNT domains)"
        _log "Firewall: dnsmasq + ipset active — $DOMAIN_COUNT domains"
    fi
else
    _skip firewall "Network firewall"
fi

# ==========================================================================
# Phase 7: User setup script
# Runs after firewall activation, before agent launch.
# ==========================================================================
SETUP_SCRIPT=$(echo "$ENVIRONMENT" | jq -r '.setupScript // ""')
if [ -n "$SETUP_SCRIPT" ]; then
    _step setup "Setup script"
    _log "Setup script: start"
    /home/agent/setup.sh 2>&1 || echo "[setup] Warning: setup script exited with error"
    _done setup "Setup script"
    _log "Setup script: done"
else
    _skip setup "Setup script"
fi

# ==========================================================================
# Phase 8: Launch — replace loading screen with clean shell + init script
# Everything is fully ready. Replace the loading indicator and hand over
# control to the user / agent. This is the last action in the entrypoint.
# ==========================================================================
_ready
sleep 0.6

# Configure pane persistence — respawn a clean shell on exit (never re-run init script)
tmux set-option -w -t "main:$WINDOW_NAME" remain-on-exit on
tmux set-hook -t main pane-died \
    "if-shell -F '#{==:#{window_name},main}' 'respawn-pane -k -c /workspace bash'"

# Replace loading screen with init.sh (runs init script or falls back to bash)
tmux respawn-pane -k -t "main:$WINDOW_NAME" -c /workspace "bash /home/agent/init.sh"

_log "Startup complete"

# Keep container alive
exec tail -f /dev/null
