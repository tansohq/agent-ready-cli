# Machine-Readable Pricing (`pricing.json`)

APIs for plan selection and payment exist. What doesn't exist: a standard way for agents to discover and compare pricing before they buy.

Most B2B pricing lives in HTML pages designed for humans. Agents can't programmatically evaluate tiers, compare overage rates, check compliance posture, or estimate costs without scraping. The "contact sales" wall is the extreme version, but even self-serve pricing pages are agent-hostile when the data isn't structured.

**`pricing.json`** is a proposed schema for exposing B2B SaaS pricing in a machine-readable format. Analogous to `robots.txt` for crawlers, `llms.txt` for LLMs, `agents.txt` for agent permissions.

Publish at your domain root: `https://example.com/pricing.json`

## Core sections

| Section | What it exposes |
|---------|----------------|
| `product` | Name, vendor, category, tech stack layer |
| `revenue_model` | Type (transactional, usage-based, seat, hybrid), billing frequency, whether agents can onboard |
| `value_metric` | What you charge for ("API call", "record enriched"), whether null results are billable |
| `plans[]` | Each plan: price, included usage, overage rates, volume tiers, features, rate limits, trial availability |
| `credits` | If credit-based: currency name, weight table, cross-product convertibility, rollover policy |
| `overages` | Model (hard stop, throttle, flex, PAYG rate), grace period |
| `governance` | Per-key limits, budget controls, spend alerts, burndown API |
| `compliance` | SOC 2, GDPR, HIPAA, data residency |
| `integration` | API docs, OpenAPI spec, MCP server, SDK languages, auth methods |
| `support` | SLA uptime, response time, support channels |
| `contact` | Sales URL, pricing page, quote API for programmatic custom quotes |

## How agents use it

1. **Discover**: Fetch `example.com/pricing.json` (or find JSON-LD on pricing page)
2. **Evaluate**: Check compliance, value metric, auth methods against requirements
3. **Compare**: Pull pricing.json from multiple vendors, normalize on value metric, rank by cost
4. **Purchase**: Hit `plans[].trial.api_provisioning_url` or `contact.quote_api_url` to initiate

## What this replaces

| Before | After |
|--------|-------|
| Scrape pricing page HTML | `GET /pricing.json` |
| "Contact sales" wall | `contact.quote_api_url` for programmatic quotes |
| Manual vendor comparison | Structured JSON diff across vendors |
| Unknown compliance posture | `compliance` block with certifications |
| Guessing overage behavior | `overages.model` + `overages.grace_period_days` |

The schema extends schema.org Product/Offer vocabulary with B2B-specific fields. The full JSON Schema and worked example are in the `schema/` directory at the repo root (`pricing.schema.json` and `pricing.example.json`).
