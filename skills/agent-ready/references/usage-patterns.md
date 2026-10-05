# Usage Monitoring Patterns

## Gold Standard: OpenAI

Every API response includes:
```
x-ratelimit-limit-requests: 10000
x-ratelimit-remaining-requests: 9999
x-ratelimit-limit-tokens: 1000000
x-ratelimit-remaining-tokens: 999984
x-ratelimit-reset-requests: 6ms
x-ratelimit-reset-tokens: 23ms
```

Plus dedicated usage endpoint: `GET /v1/usage` with daily/monthly breakdowns.

## Gold Standard: Twilio

Usage Records API: `/2010-04-01/Accounts/{sid}/Usage/Records.json`
- Filter by category, date range
- Daily/monthly/all-time granularity
- Includes cost per resource type

## What Works
- Rate limit headers on every response (remaining requests, reset time)
- Dedicated usage API (`GET /v1/usage?period=current_month`)
- Billing API (current invoice, projected cost)
- Quota endpoint (current limits, how close to hitting them)
- Webhooks for threshold events (80% quota, overage, billing failure)
- Cost-per-request in response headers or metadata

## What Blocks Agents

| Anti-Pattern | Why It Kills Agents | Fix |
|---|---|---|
| Dashboard-only usage | No API equivalent | Add `GET /v1/usage` endpoint |
| Monthly email invoices only | No real-time visibility | Billing API with current-period data |
| No rate limit headers | Agent can't self-throttle | Add `x-ratelimit-*` headers to all responses |
| Delayed usage data | Only available after billing cycle | Real-time or near-real-time usage endpoint |
| No threshold alerts | Agent can't react to limits | Webhooks for quota, overage, billing events |

## Minimum Viable Usage API
```
GET /v1/usage
Response:
{
  "period": "2026-05",
  "requests": 45230,
  "limit": 100000,
  "cost_usd": 23.45,
  "projected_cost_usd": 52.10,
  "usage_by_endpoint": {...}
}
```
