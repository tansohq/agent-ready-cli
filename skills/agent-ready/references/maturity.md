# Agent-Serve Maturity Model

## Levels

### Level 0: Agent-Hostile
- Browser-only everything
- No API
- CAPTCHA + email verification
- "Contact sales" for pricing

### Level 1: API Exists
- REST API for core product features
- API keys (manually generated)
- Docs available online
- But: no programmatic signup, billing, or management

### Level 2: Agent-Possible
- API signup (with some friction)
- API keys with scopes
- Usage visible via API
- Billing still requires dashboard

### Level 3: Agent-Friendly
- Full programmatic onboarding
- OAuth Client Credentials
- Plan selection + payment via API
- Usage + billing API
- Configuration via API

### Level 4: Agent-First (Gold Standard)
- Zero-friction agent provisioning
- MCP server as product interface
- Spending policies (human sets guardrails, agent executes)
- Agent identity verification
- Self-serve everything
- Examples: Stripe Projects, Cloudflare (2026)

---

## Three Levels of AX (Burazin, Daytona)

### Table Stakes (most stop here)
- API-first
- Markdown docs, llms.txt
- Parallelization support
- Headless tooling

### Reactive AX (current state of the industry)
- Agents can use the product but kick control back to human when stuck
- Token refresh requires human, workflow errors escalate to dashboard

### True AX (target state)
- Agents never get stuck, never phone home
- Everything API-driven: spin up, archive, delete via endpoints
- Parallelization: hundreds of environments at once
- Agent-Native Volumes (persistent storage across sandboxes)
- New primitives beyond standard infra

Key test: "If you haven't created any net-new primitives for agents, you haven't started building for the agent-native world." (Burazin)

---

## Dev Readiness as an Intersecting Dimension

The levels above measure ACCESS — can agents get in? Dev readiness measures QUALITY — is it good once they're in? These are orthogonal:

- **Level 3 access + poor dev readiness**: everything is API-accessible but errors are vague, no idempotency, no test mode, offset pagination breaks under load.
- **Level 1 access + great dev readiness**: only core features exposed but the API is beautifully designed — structured errors, idempotency, cursor pagination, OpenAPI spec.

The practical progression:
- Level 0-1: API design quality doesn't matter yet (no API or minimal API)
- Level 2: Dev readiness becomes the differentiator. Two products with API-possible access — the one with structured errors, test mode, and an OpenAPI spec wins.
- Level 3-4: Dev readiness is table stakes. MCP server quality, A2A Agent Card, agent toolkits, and llms.txt separate the leaders.

Assess both dimensions independently. A product can be agent-friendly (Level 3) but developer-hostile (poor DX) — or developer-friendly (great DX) but agent-hostile (no programmatic access).
