#!/bin/bash
# Shared helpers for agent setup scripts.
# Source this file: source /home/agent/agents/common.sh

# Slugify a name for use as a filesystem-safe identifier.
# Usage: SAFE=$(safe_name "My Skill Name")  →  "my-skill-name"
safe_name() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'
}

# Merge AGENTS_MD JSON entries and write to a single markdown file.
# Always overwrites — on rebuild, we want fresh Agentor content (not duplicated appends).
# Usage: write_agents_md ~/.claude/CLAUDE.md
write_agents_md() {
    local output_path="$1"
    [ -z "$AGENTS_MD" ] && return
    local count
    count=$(echo "$AGENTS_MD" | jq -r 'length' 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return

    local merged=""
    for i in $(seq 0 $((count - 1))); do
        local name content
        name=$(echo "$AGENTS_MD" | jq -r ".[$i].name")
        content=$(echo "$AGENTS_MD" | jq -r ".[$i].content")
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

# Write each SKILLS JSON entry as a markdown SKILL.md file.
# Creates: <base_dir>/agentor-<safe-name>/SKILL.md
# Usage: write_skills_md ~/.claude/skills
write_skills_md() {
    local base_dir="$1"
    [ -z "$SKILLS" ] && return
    local count
    count=$(echo "$SKILLS" | jq -r 'length' 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return

    for i in $(seq 0 $((count - 1))); do
        local name content safe skill_dir
        name=$(echo "$SKILLS" | jq -r ".[$i].name")
        content=$(echo "$SKILLS" | jq -r ".[$i].content")
        safe=$(safe_name "$name")
        skill_dir="${base_dir}/agentor-${safe}"
        mkdir -p "$skill_dir"
        echo "$content" > "$skill_dir/SKILL.md"
    done
}

# Write each SKILLS JSON entry as a Gemini TOML command file.
# Strips YAML frontmatter before writing.
# Creates: <dir>/agentor-<safe-name>.toml
# Usage: write_skills_toml ~/.gemini/commands
write_skills_toml() {
    local dir="$1"
    [ -z "$SKILLS" ] && return
    local count
    count=$(echo "$SKILLS" | jq -r 'length' 2>/dev/null || echo 0)
    [ "$count" -eq 0 ] && return

    mkdir -p "$dir"
    for i in $(seq 0 $((count - 1))); do
        local name content safe body escaped
        name=$(echo "$SKILLS" | jq -r ".[$i].name")
        content=$(echo "$SKILLS" | jq -r ".[$i].content")
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
