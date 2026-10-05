# audit.json

Schema id: `agent-ready/audit@1`. Written by the auditing agent, validated by `npx @tansohq/agent-ready validate audit.json`.

```json
{
  "schema": "agent-ready/audit@1",
  "runId": "<copy from scan.json>",
  "target": { "url": "https://example.dev" },
  "startedAt": "2026-09-09T10:03:00.000Z",
  "finishedAt": "2026-09-09T10:09:00.000Z",
  "provider": { "name": "audit", "version": "0.1.0", "model": "<model name you are running as>" },
  "available": true,
  "areas": {
    "onboarding":       { "score": 2, "today": "Browser signup with reCAPTCHA and an email confirmation link.", "blocks": ["reCAPTCHA on the only signup form", "Email verification loop before the first key"], "build": "POST /v1/accounts with email+password returning the API key; no email verification; abuse control via IP reputation.", "effort": "M", "reference": "Cloudflare agent provisioning" },
    "authentication":   { "score": 5, "today": "...", "blocks": ["..."], "build": "...", "effort": "S", "reference": "Stripe restricted keys" },
    "purchasing":       { "score": 3, "today": "...", "blocks": ["..."], "build": "...", "effort": "M", "reference": "Stripe Subscriptions API" },
    "usage_monitoring": { "score": 4, "today": "...", "blocks": ["..."], "build": "...", "effort": "S", "reference": "Twilio Usage Records" },
    "self_management":  { "score": 2, "today": "...", "blocks": ["..."], "build": "...", "effort": "S", "reference": "Stripe Subscriptions lifecycle" },
    "dev_readiness":    { "score": 6, "today": "...", "blocks": ["..."], "build": "...", "effort": "M", "reference": "Stripe idempotency" }
  },
  "hard_blockers": [
    { "area": "onboarding", "text": "reCAPTCHA on the only signup form stops every agent before an account exists." }
  ],
  "quick_wins": [
    { "area": "authentication", "text": "Return the first API key in the signup response instead of the dashboard." }
  ],
  "roadmap": ["Remove CAPTCHA from the API signup path", "Plan catalog + SetupIntent purchase", "Usage endpoint"],
  "maturity": 1
}
```

Rules:
- `score` is an integer 0-10. `effort` is `S`, `M` or `L`. `maturity` is an integer 0-4.
- `blocks` is an array of short, specific strings. One friction per string. Empty array when nothing blocks.
- `area` in `hard_blockers` and `quick_wins` must be one of the six area keys.
- All six areas are required. If an area cannot be assessed, score it conservatively and say why in `today`.

How the report uses it: area score ≤3 → stage `BLOCKED`, 4-7 → `HUMAN_REQUIRED`, ≥8 → `AGENT_CAPABLE`. `onboarding`→signup, `authentication`→access, `purchasing`→pay, `usage_monitoring`→use, `self_management`→manage. `dev_readiness` becomes a quality band, not a stage. `blocks` become findings (high when the area is ≤3, else medium); `hard_blockers` are high findings; `quick_wins` are low findings with the text as the fix. A crash run that acted on a stage overrides the audit's judgement of it.
