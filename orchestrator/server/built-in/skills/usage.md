---
name: agentor-usage-monitoring
description: Check your remaining agent usage quota. Use when you need to check rate limits, remaining capacity, or plan around quota resets before starting a large task.
user-invocable: false
---

# Check your remaining agent usage quota

Use this skill when you need to check how much of your usage quota is remaining, whether you're close to a rate limit, or when your quota resets. This is useful for planning long-running tasks or deciding when to pause work.

## How it works

The orchestrator periodically polls usage APIs for all configured agents (Claude, Codex, Gemini) and exposes a unified endpoint. Usage data is only available for agents authenticated via OAuth (subscription accounts). API key-based agents show no usage data.

## API Reference

### Get usage status

```bash
curl "$ORCHESTRATOR_URL/api/usage"
```

Returns a JSON object with per-agent usage information:

```json
{
  "agents": [
    {
      "agentId": "claude",
      "displayName": "Claude",
      "authType": "oauth",
      "usageAvailable": true,
      "windows": [
        {
          "label": "Session",
          "utilization": 45.2,
          "resetsAt": "2025-01-15T12:00:00Z"
        }
      ]
    }
  ]
}
```

**What the fields mean:**
- `agentId` — Which agent (claude, codex, gemini)
- `authType` — How the agent authenticates: `"oauth"` (subscription), `"api-key"`, or `"none"`
- `usageAvailable` — Whether usage data could be retrieved. `false` for API key auth or when the token is expired
- `windows[]` — Usage windows, each with:
  - `label` — Window name (e.g. "Session", "Weekly")
  - `utilization` — Percentage used, 0-100. Over 80% means you're close to hitting limits
  - `resetsAt` — ISO 8601 timestamp when the window resets

## When to check

- Before starting a large task that will consume significant quota
- When you're getting rate-limited or experiencing slow responses
- To decide whether to continue working or wait for a quota reset
