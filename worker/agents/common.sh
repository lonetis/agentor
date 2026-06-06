#!/bin/bash
# Shared helpers for agent setup scripts.
# Source this file: source /home/agent/agents/common.sh

# Slugify a name for use as a filesystem-safe identifier.
# Usage: SAFE=$(safe_name "My Capability Name")  →  "my-capability-name"
safe_name() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'
}

# The three writers below stream their JSON array one compact object per line
# (`jq -c '.[]'`, the same idiom the entrypoint uses for repos) and extract
# name/content per object — one `jq` per entry rather than two. `.content` is a
# single JSON string, so a compact object is always exactly one line.

# Merge INSTRUCTIONS JSON entries and write to a single markdown file.
# Always overwrites — on rebuild, we want fresh Agentor content (not duplicated appends).
# Usage: write_instructions ~/.claude/CLAUDE.md
write_instructions() {
    local output_path="$1"
    [ -z "$INSTRUCTIONS" ] && return
    local count
    count=$(echo "$INSTRUCTIONS" | jq -r 'length' 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return

    local merged="" entry name content underline
    while IFS= read -r entry; do
        name=$(echo "$entry" | jq -r '.name')
        content=$(echo "$entry" | jq -r '.content')
        [ -n "$merged" ] && merged="${merged}

---

"
        underline=$(printf '=%.0s' $(seq 1 ${#name}))
        merged="${merged}${name}
${underline}

${content}"
    done < <(echo "$INSTRUCTIONS" | jq -c '.[]')

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

    local entry name content safe skill_dir
    while IFS= read -r entry; do
        name=$(echo "$entry" | jq -r '.name')
        content=$(echo "$entry" | jq -r '.content')
        safe=$(safe_name "$name")
        skill_dir="${base_dir}/agentor-${safe}"
        mkdir -p "$skill_dir"
        echo "$content" > "$skill_dir/SKILL.md"
    done < <(echo "$CAPABILITIES" | jq -c '.[]')
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
    local entry name content safe body escaped
    while IFS= read -r entry; do
        name=$(echo "$entry" | jq -r '.name')
        content=$(echo "$entry" | jq -r '.content')
        safe=$(safe_name "$name")
        body=$(echo "$content" | sed -n '/^---$/,/^---$/!p' | sed '/./,$!d')
        escaped=$(echo "$body" | sed 's/\\/\\\\/g')
        cat > "${dir}/agentor-${safe}.toml" <<TOMLEOF
description = "${name}"
prompt = """
${escaped}
"""
TOMLEOF
    done < <(echo "$CAPABILITIES" | jq -c '.[]')
}
