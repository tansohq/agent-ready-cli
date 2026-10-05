# Onboarding Patterns

## Gold Standard: Cloudflare (2026)

Agents create accounts, buy domains, start paid subscriptions, deploy apps. Zero manual steps beyond ToS acceptance. Protocol:
- REST/JSON catalog for service discovery
- Identity attestation + OAuth for auth
- Tokenized payment with configurable spend cap ($100/month default)

## Gold Standard: Stripe Projects

Agents get scoped API keys per project with explicit capabilities (read billing, create charges up to threshold). GA since April 2026 and now lists 50+ providers.

## What Works
- `POST /v1/accounts` — returns account ID + API key in one call
- Instant sandbox/trial access (no approval queue)
- Programmatic ToS acceptance (checkbox equivalent via API param)
- Tiered access: start restricted, unlock via verification

## What Blocks Agents

| Anti-Pattern | Why It Kills Agents | Fix |
|---|---|---|
| CAPTCHA | Browser fingerprinting, behavioral scoring | Web Bot Auth (profile of RFC 9421, live at Cloudflare/AWS WAF/Vercel/Shopify/Akamai as of early 2026), IP reputation, proof-of-work |
| Email verification | Agent has no inbox | OAuth Client Credentials, domain verification |
| SMS OTP | Requires phone | TOTP (agent can compute), or skip for API-only access |
| Manual approval queues | "We'll review your application" | Self-serve provisioning API |
| Multi-step browser wizards | No headless path | Single API call signup |
| Device fingerprinting | Headless Chrome gets blocked | Web Bot Auth (profile of RFC 9421), allowlist verified agents |

## Practical Fix

If you can't remove email verification entirely:
1. Offer API key auth that bypasses email for programmatic access
2. Or: accept a verified domain as identity proof
3. Or: support OAuth Client Credentials (identity comes from the OAuth provider, not email)

---

## Deploy-First-Claim-Later Pattern

The most agent-friendly onboarding pattern: let agents provision immediately, require identity later.

**Netlify**: `netlify deploy --allow-anonymous` — 1-hour claim window. Agent deploys, developer claims the project later.

**Prisma**: `npx create-db` — 24-hour claim window. Free permanent tier if claimed.

**Pattern**: `POST /v1/provision` returns scoped credentials + TTL. No signup gate. Developer confirms ownership within window.

Why this works: agents prefer recommending tools they can set up end-to-end. "Leave your terminal to create an account" is where agents lose the developer.

---

## Sandbox Provisioning

For dev tool products, the agent-serve path is often about instant sandbox access.

| Provider | Cold start | Pattern |
|----------|-----------|---------|
| Daytona | sub-90ms | POST /v1/sandboxes, returns scoped credentials + TTL |
| E2B | ~200ms | Python/JS SDKs, code interpreter sandboxes |
| Cloudflare Dynamic Workers | instant | Worker-per-request isolation |

Pattern: `POST /v1/sandboxes` returns scoped credentials + TTL, no signup gate.
