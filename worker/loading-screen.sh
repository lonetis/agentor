#!/bin/bash
# loading-screen.sh — Animated worker startup display
# Reads events from /tmp/worker-events and renders a live status screen.
# Runs inside the tmux pane; entrypoint.sh writes events as phases complete.

EVENTS="/tmp/worker-events"

# Braille spinner frames
SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
SPIN_I=0

# ANSI escape codes
RST='\033[0m'
BLD='\033[1m'
DIM='\033[2m'
GRN='\033[32m'
YLW='\033[33m'
CYN='\033[36m'

# State tracking
declare -a IDS=()
declare -A STATUS=() LABEL=() ELAPSED=()
TOTAL=0
READY=false
BOOT_MS=0

# Show cursor on exit (safety net)
trap 'printf "\033[?25h"' EXIT

now_ms() {
    local up
    read -r up _ < /proc/uptime
    echo "${up/./}"
}

parse() {
    local -A seen=()
    IDS=()

    while IFS='|' read -r id rest; do
        [ -z "$id" ] && continue
        case "$id" in
            BOOT)  BOOT_MS="$rest" ;;
            TOTAL) TOTAL="$rest" ;;
            READY) READY=true ;;
            *)
                IFS='|' read -r status label elapsed <<< "$rest"
                if [ -z "${seen[$id]}" ]; then
                    IDS+=("$id")
                    seen[$id]=1
                fi
                STATUS[$id]="$status"
                LABEL[$id]="$label"
                [ -n "$elapsed" ] && ELAPSED[$id]="$elapsed"
                ;;
        esac
    done < "$EVENTS" 2>/dev/null
}

fmt_time() {
    local cs=$1
    if [ "$cs" -ge 100 ]; then
        printf '%d.%ds' $((cs / 100)) $(( (cs % 100) / 10 ))
    else
        printf '%dms' $((cs * 10))
    fi
}

render() {
    local cols
    cols=$(tput cols 2>/dev/null || echo 80)

    local total_ms=0
    [ "$BOOT_MS" -gt 0 ] 2>/dev/null && total_ms=$(( $(now_ms) - BOOT_MS ))
    local time_str
    time_str=$(fmt_time "$total_ms")

    printf '\033[?25l'  # hide cursor
    printf '\033[H'     # cursor home (no clear — reduces flicker)

    # ── Header ──
    if $READY; then
        printf '\n  %b%b✓%b %bAgentor Worker%b' "$GRN" "$BLD" "$RST" "$BLD" "$RST"
    else
        printf '\n  %b%b%s%b %bAgentor Worker%b' "$CYN" "$BLD" "${SPIN[$SPIN_I]}" "$RST" "$BLD" "$RST"
    fi

    # Right-align elapsed time
    local vis_len=19  # "  X Agentor Worker"
    local pad=$(( cols - vis_len - ${#time_str} - 1 ))
    [ "$pad" -lt 1 ] && pad=1
    printf '%*s%b%s%b\n' "$pad" '' "$DIM" "$time_str" "$RST"

    # ── Separator ──
    local rule_w=$(( cols - 4 ))
    [ "$rule_w" -gt 40 ] && rule_w=40
    printf '  %b' "$DIM"
    printf '%*s' "$rule_w" '' | tr ' ' '─'
    printf '%b\n\033[K\n' "$RST"

    # ── Steps ──
    local done_n=0

    for id in "${IDS[@]}"; do
        local s="${STATUS[$id]}"
        local l="${LABEL[$id]}"
        local e="${ELAPSED[$id]}"

        case "$s" in
            done)
                done_n=$((done_n + 1))
                printf '  %b✓%b %s' "$GRN" "$RST" "$l"
                if [ -n "$e" ]; then
                    local ts
                    ts=$(fmt_time "$e")
                    local slen=$((4 + ${#l}))
                    local sp=$(( cols - slen - ${#ts} - 2 ))
                    [ "$sp" -lt 1 ] && sp=1
                    printf '%*s%b%s%b' "$sp" '' "$DIM" "$ts" "$RST"
                fi
                printf '\033[K\n'
                ;;
            warn)
                done_n=$((done_n + 1))
                printf '  %b⚠%b %s\033[K\n' "$YLW" "$RST" "$l"
                ;;
            skip)
                done_n=$((done_n + 1))
                printf '  %b–%b %b%s%b\033[K\n' "$DIM" "$RST" "$DIM" "$l" "$RST"
                ;;
            active)
                printf '  %b%s%b %s\033[K\n' "$YLW" "${SPIN[$SPIN_I]}" "$RST" "$l"
                ;;
        esac
    done

    # ── Progress bar ──
    local total_steps=$TOTAL
    [ "$total_steps" -eq 0 ] 2>/dev/null && total_steps=${#IDS[@]}

    if [ "$total_steps" -gt 0 ]; then
        printf '\033[K\n'
        local bw=$(( cols - 12 ))
        [ "$bw" -gt 32 ] && bw=32
        [ "$bw" -lt 8 ] && bw=8
        local fill=$(( done_n * bw / total_steps ))
        local empty=$(( bw - fill ))

        # Cyan while loading, green when complete
        local bar_clr="$CYN"
        if [ "$done_n" -eq "$total_steps" ]; then
            bar_clr="$GRN"
        fi

        printf '  %b' "$bar_clr"
        printf '%*s' "$fill" '' | tr ' ' '█'
        printf '%b%b' "$RST" "$DIM"
        printf '%*s' "$empty" '' | tr ' ' '░'
        printf '%b %b%d/%d%b\033[K\n' "$RST" "$DIM" "$done_n" "$total_steps" "$RST"
    fi

    # Clear any leftover lines from previous (longer) renders
    printf '\033[J'
}

# Wait for events file (timeout after 30s to avoid hanging forever)
WAIT_COUNT=0
while [ ! -f "$EVENTS" ]; do
    sleep 0.05
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ "$WAIT_COUNT" -ge 600 ]; then
        printf '\n  \033[31mError: worker events file not created after 30s\033[0m\n'
        exec sleep infinity
    fi
done

# Main render loop (~12 fps)
while true; do
    parse
    render
    SPIN_I=$(( (SPIN_I + 1) % ${#SPIN[@]} ))

    if $READY; then
        # Hold the pane open until entrypoint's respawn-pane -k replaces it.
        # The entrypoint sleeps 0.6s after _ready, so the final frame stays
        # visible briefly before the terminal takes over.
        printf '\033[?25h'  # show cursor
        exec sleep infinity
    fi

    sleep 0.08
done
