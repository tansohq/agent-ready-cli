# Self-Management Patterns

## Gold Standard: Stripe Subscriptions API

Full lifecycle via API:
- `POST /v1/subscriptions` — create
- `PATCH /v1/subscriptions/{id}` — change plan, quantity
- `DELETE /v1/subscriptions/{id}` — cancel
- Proration handled automatically
- Dunning/retry built in

## What Works
- Plan upgrade/downgrade via API (`PATCH /v1/subscription`)
- Cancel via API (immediate or end-of-period)
- Configuration via API (not dashboard-only settings)
- Team/seat management via API
- Data export endpoint
- Account deletion endpoint (GDPR compliance)

## What Blocks Agents

| Anti-Pattern | Why It Kills Agents | Fix |
|---|---|---|
| "Contact support to cancel" | No self-serve path | `DELETE /v1/subscriptions/{id}` |
| "Contact support to downgrade" | Requires human | `PATCH /v1/subscriptions/{id}` with new plan |
| Dashboard-only settings | No API | REST API or MCP server for config |
| Dashboard-only team management | Requires admin UI | Team/seat management API |
| No data portability API | Agent can't export | Data export endpoint |
| Contract-gated plan changes | Requires amendment | Self-serve plan changes with proration |
| PDF-only documentation | Not parseable as tool schemas | OpenAPI spec + llms.txt |

## MCP Server as Management Interface

The emerging pattern for full self-management. Instead of many REST endpoints, ship one MCP server that exposes tools:

```json
{
  "tools": [
    {"name": "get_usage", "description": "Current period usage and costs"},
    {"name": "list_plans", "description": "Available plans with pricing"},
    {"name": "change_plan", "description": "Upgrade or downgrade subscription"},
    {"name": "get_invoices", "description": "Past and current invoices"},
    {"name": "update_config", "description": "Change product settings"}
  ]
}
```

Companies shipping MCP servers today: Stripe, Supabase, Cloudflare, Sentry, Expo, Hugging Face.
