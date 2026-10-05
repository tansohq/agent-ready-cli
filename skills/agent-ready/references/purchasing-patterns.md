# Purchasing Patterns

## How It Works Today: Agents Use Stripe Like Any API Client

Most SaaS already uses Stripe. Agents don't need a special payment protocol — they need you to expose what Stripe already supports as API endpoints instead of browser redirects.

The pattern: human pre-authorizes a payment method once (Setup Intent -> saved `pm_...`), agent reuses it for purchases via Stripe's Subscriptions API. No browser, no checkout page, no human in the loop after initial setup.

## Practical Implementation (works now, no special programs)

If you use Stripe (most SaaS does):
1. Expose `GET /v1/plans` returning plan IDs, prices, features, limits
2. Accept `POST /v1/subscriptions` with plan_id + payment_method
3. Accept `payment_method` (pm_...) in upgrade requests — attach to customer, then subscribe. No browser needed.
4. Fall back to 402 + checkout URL only when no payment method is provided AND none is on file
5. Use Stripe Payment Intents API (not Checkout Sessions) for programmatic payment
6. Add usage-based component if applicable (Stripe metered billing)

Where the `pm_...` comes from:
- **Human pre-authorization via Setup Intent** — most common path. Human saves a card once, agent uses it going forward
- **Stripe Link wallet** — agent draws from the human's Link account
- **Stripe Agent Toolkit** (`@stripe/agent-toolkit`) — gives agents direct access to Stripe operations with scoped permissions

Reference: https://docs.stripe.com/api/payment_methods — Stripe Payment Methods API
Reference: https://docs.stripe.com/payments/save-and-reuse — Save and reuse payment methods
Reference: https://docs.stripe.com/agents — Stripe Agent Toolkit

## What Works
- Plan catalog as JSON endpoint (`GET /v1/plans`)
- Plan selection via API (`POST /v1/subscriptions` with plan_id)
- Stripe Payment Intents / Setup Intents (no browser checkout required)
- Usage-based billing with automatic metering (no manual usage reports)
- Spending caps / policies (human sets limit, agent spends within it)

## What Blocks Agents

| Anti-Pattern | Why It Kills Agents | Fix |
|---|---|---|
| "Contact sales" gates | No self-serve path | Add API-accessible tier (even if limited) |
| Browser-only Stripe Checkout | Redirect flow, no API | Stripe Payment Intents API |
| Manual invoice / PO process | Requires human | Programmatic billing via Stripe |
| Pricing hidden behind demo request | Agent can't evaluate | Publish pricing.json |
| Enterprise-only tiers | No self-serve option | Add a developer/starter tier |
| Annual contracts only | Agents need flexibility | Monthly or usage-based option |

## A Note on "Tokenized Payments"

You'll see "tokenized payments" in agent commerce writing. There are two layers:

**Saved payment methods (`pm_...`)** — the familiar Stripe pattern. Human saves a card via Setup Intent, agent reuses the `pm_...` to subscribe. Works today, no special program needed. Limitation: only works within one merchant's Stripe account.

**Agent-specific primitives (new, 2026)** — genuinely different from saved cards:
- **Shared Payment Tokens (SPTs)** — time-limited (minutes, not permanent), scoped to a specific business, revocable. Work cross-merchant via Link wallet. Supports cards, Affirm, Klarna.
- **Issuing for agents** — actual virtual card numbers agents use at any merchant, with per-transaction spend controls and real-time authorization.
- **Link wallet** — human authorizes wallet access once, agent requests a new one-time card or SPT per transaction, across different vendors. Agent never sees raw credentials.

The cross-merchant capability is the real difference. A saved `pm_...` is locked to one Stripe account. SPTs and virtual cards let agents pay across merchants with human-set guardrails.

For most SaaS building agent-friendly purchasing: accept saved `pm_...` via your API first. SPTs and virtual cards will flow in from agents that already have them — you don't need to implement anything extra to accept them.

## Stripe Projects (GA since April 2026)

Stripe Projects is a curated marketplace where agents get scoped API keys, discover services from a catalog, and pay via one-time-use virtual cards. Launched at Sessions 2026 and now lists 50+ providers. To join as a provider, apply through Stripe's provider intake.

Most SaaS should still focus on the Setup Intent + Subscriptions API pattern first — Projects is additive, not a prerequisite.
