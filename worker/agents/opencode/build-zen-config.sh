#!/bin/bash
# Build-time catalog snapshot, including the supported reasoning choices.
# models.dev names the Zen catalog `opencode`; our provider ID is `zen`.
set -euo pipefail

curl -fsSL --retry 3 -A "opencode/$(opencode --version | sed 's/^opencode v//')" https://models.dev/api.json | jq -e '
    .opencode | select(.api == "https://opencode.ai/zen/v1") |
    .models |= with_entries(select(.value.status != "deprecated")) |
    select(.models | length > 0)
' > /home/agent/agents/opencode/zen-provider.json
