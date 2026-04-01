#!/bin/bash
# Shared helpers for agent setup scripts.
# Source this file: source /home/agent/agents/common.sh

# Slugify a name for use as a filesystem-safe identifier.
# Usage: SAFE=$(safe_name "My Capability Name")  →  "my-capability-name"
safe_name() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'
}

# Merge INSTRUCTIONS JSON entries and write to a single markdown file.
# Always overwrites — on rebuild, we want fresh Agentor content (not duplicated appends).
# Usage: write_instructions ~/.claude/CLAUDE.md
write_instructions() {
    local output_path="$1"
    [ -z "$INSTRUCTIONS" ] && return
    local count
    count=$(echo "$INSTRUCTIONS" | jq -r 'length' 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return

    local merged=""
    for i in $(seq 0 $((count - 1))); do
        local name content
        name=$(echo "$INSTRUCTIONS" | jq -r ".[$i].name")
        content=$(echo "$INSTRUCTIONS" | jq -r ".[$i].content")
        [ -n "$merged" ] && merged="${merged}

---

"
        local underline
        underline=$(printf '=%.0s' $(seq 1 ${#name}))
        merged="${merged}${name}
${underline}

${content}"
    done

    mkdir -p "$(dirname "$output_path")"
    echo "$merged" > "$output_path"
}

# Write each CAPABILITIES JSON entry as a markdown SKILL.md file.
# Creates: <base_dir>/agentor-<safe-name>/SKILL.md
# Usage: write_capabilities_md ~/.claude/skills
write_capabilities_md() {
    local base_dir="$1"
    [ -z "$CAPABILITIES" ] && return
    local count
    count=$(echo "$CAPABILITIES" | jq -r 'length' 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return

    for i in $(seq 0 $((count - 1))); do
        local name content safe skill_dir
        name=$(echo "$CAPABILITIES" | jq -r ".[$i].name")
        content=$(echo "$CAPABILITIES" | jq -r ".[$i].content")
        safe=$(safe_name "$name")
        skill_dir="${base_dir}/agentor-${safe}"
        mkdir -p "$skill_dir"
        echo "$content" > "$skill_dir/SKILL.md"
    done
}

# Write each CAPABILITIES JSON entry as a Gemini TOML command file.
# Strips YAML frontmatter before writing.
# Creates: <dir>/agentor-<safe-name>.toml
# Usage: write_capabilities_toml ~/.gemini/commands
write_capabilities_toml() {
    local dir="$1"
    [ -z "$CAPABILITIES" ] && return
    local count
    count=$(echo "$CAPABILITIES" | jq -r 'length' 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return

    mkdir -p "$dir"
    for i in $(seq 0 $((count - 1))); do
        local name content safe body escaped
        name=$(echo "$CAPABILITIES" | jq -r ".[$i].name")
        content=$(echo "$CAPABILITIES" | jq -r ".[$i].content")
        safe=$(safe_name "$name")
        body=$(echo "$content" | sed -n '/^---$/,/^---$/!p' | sed '/./,$!d')
        escaped=$(echo "$body" | sed 's/\\/\\\\/g')
        cat > "${dir}/agentor-${safe}.toml" <<TOMLEOF
description = "${name}"
prompt = """
${escaped}
"""
TOMLEOF
    done
}
