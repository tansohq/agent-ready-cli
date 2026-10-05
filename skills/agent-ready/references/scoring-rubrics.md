# Agent-Serve Scoring Rubrics

Score between anchor points (0, 3, 5, 8, 10) by interpolating based on how many criteria of the higher anchor are met.

## Onboarding (0-10)

Check for:
- API-based account creation endpoint (`POST /signup`, `POST /accounts`)
- Whether signup requires browser interaction (CAPTCHA, email click, phone verification)
- How many steps from zero to "has an account"
- Whether there's a programmatic trial/sandbox mode

| Score | Meaning |
|-------|---------|
| 0 | Browser-only signup with CAPTCHA |
| 3 | API signup exists but requires email verification loop |
| 5 | API signup with instant access, but limited (needs manual upgrade) |
| 8 | Full API onboarding, instant access, sandbox/trial included |
| 10 | Agent provisions itself completely (Cloudflare model) |

## Authentication (0-10)

Check for:
- API key generation (programmatic or self-serve dashboard)
- OAuth 2.0 Client Credentials Grant support
- Service account pattern (GCP model)
- Blockers: magic links, SMS OTP, browser-only OAuth consent, device fingerprinting

| Score | Meaning |
|-------|---------|
| 0 | SSO-only or magic-link-only, no API auth path |
| 3 | API keys exist but require human to generate in dashboard |
| 5 | API keys + scoped permissions, but no machine-to-machine OAuth |
| 8 | Client Credentials Grant + scoped API keys + key rotation API |
| 10 | Full programmatic identity with cryptographic attestation |

## Purchasing (0-10)

Check for:
- Programmatic plan selection endpoint
- Payment via Stripe API (Payment Intents / saved payment methods) without browser redirect
- Transparent pricing (machine-readable plans, limits, rates)
- Whether upgrade/plan-change requires "talk to sales"

| Score | Meaning |
|-------|---------|
| 0 | "Contact sales" only |
| 3 | Self-serve pricing page but payment requires browser checkout |
| 5 | Stripe Checkout with direct link (semi-programmatic) |
| 8 | Full billing API — plan catalog, Stripe Subscriptions + saved payment method, no browser |
| 10 | 8 + machine-readable pricing (pricing.json) + spending policies + agent self-serve upgrades |

## Usage Monitoring (0-10)

Check for:
- Usage/consumption API endpoint
- Rate limit headers on responses (`x-ratelimit-remaining-*`)
- Billing/invoice API
- Quota/limits visibility
- Alerting/webhook for threshold events

| Score | Meaning |
|-------|---------|
| 0 | Dashboard-only, no API for usage data |
| 3 | Basic rate limit headers but no usage API |
| 5 | Usage API exists but limited (daily aggregates only) |
| 8 | Real-time usage + billing API + threshold webhooks |
| 10 | Full observability (OpenAI model: per-request tokens + cost) |

## Self-Management (0-10)

Check for:
- Plan change via API (upgrade, downgrade)
- Cancel via API
- Configuration changes via API (not dashboard-only)
- Team/seat management via API
- Data export/deletion via API

| Score | Meaning |
|-------|---------|
| 0 | All management requires dashboard or support ticket |
| 3 | Some settings via API, but plan changes require human |
| 5 | Plan changes via API, but cancel requires support |
| 8 | Full lifecycle management via API |
| 10 | Complete self-serve + MCP server for agent interaction |

## Dev Readiness (0-10)

Check for:
- Structured error responses with type, code, message, and failing parameter
- Request IDs on every response
- Idempotency key support on mutating endpoints
- Cursor-based pagination on list endpoints
- API versioning with pinnable versions
- OpenAPI spec published and complete
- Test mode with separate keys and fixtures
- llms.txt with curated technical content
- MCP server quality (tool naming, descriptions, curated surface)
- A2A Agent Card (if applicable)
- SDK availability and quickstart quality
- Time-to-first-call

| Score | Meaning |
|-------|---------|
| 0 | HTML errors, no docs, no test mode, no versioning |
| 3 | JSON errors but generic, basic docs exist, no idempotency |
| 5 | Structured errors + OpenAPI spec + some test mode, but no idempotency or versioning |
| 8 | Full error model + idempotency + cursor pagination + versioned API + test mode + SDK + llms.txt |
| 10 | 8 + time-to-first-call under 5 min + curated MCP server + agent toolkit (if applicable) + A2A Agent Card (if applicable) |
