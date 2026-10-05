# crash.json

Schema id: `agent-ready/crash@1`. Written by the agent that attempted the task, validated by `npx @tansohq/agent-ready validate crash.json`.

```json
{
  "schema": "agent-ready/crash@1",
  "runId": "<copy from scan.json>",
  "target": { "url": "https://staging.example.dev" },
  "startedAt": "2026-09-09T10:10:00.000Z",
  "finishedAt": "2026-09-09T10:31:00.000Z",
  "provider": { "name": "crash", "version": "0.1.0", "model": "<model name>" },
  "available": true,
  "mode": "full",
  "persona": "agent with a task and a $50 budget",
  "task": "Sign up for the free tier, get an API key, upgrade to Starter, make one metered call.",
  "flows": [
    { "id": "discover",   "result": "PASS", "human_interventions": 0, "quote": "robots.txt allows me; agent.json points at signup and pricing.", "http": { "method": "GET", "url": "https://staging.example.dev/.well-known/agent.json", "status": 200 } },
    { "id": "understand", "result": "PASS", "human_interventions": 0, "quote": "pricing.json lists three plans with included usage.", "http": { "method": "GET", "url": "https://staging.example.dev/pricing.json", "status": 200 } },
    { "id": "signup",     "result": "PASS", "human_interventions": 0, "quote": "POST /v1/accounts returned 201 with an api_key. No inbox needed.", "http": { "method": "POST", "url": "https://staging.example.dev/v1/accounts", "status": 201, "body": "{\"id\":\"acct_9f2\",\"api_key\":\"ak_…\"}" }, "screenshot": "screenshots/03-signup-201.png" },
    { "id": "access",     "result": "PASS", "human_interventions": 0, "quote": "The key works on my own account and is refused on another (403).", "http": { "method": "GET", "url": "https://staging.example.dev/v1/me", "status": 200 } },
    { "id": "pay",        "result": "FAIL", "human_interventions": 0, "quote": "change-plan returns a checkout_url that needs a browser. I can't complete this without a human.", "http": { "method": "POST", "url": "https://staging.example.dev/billing/change-plan", "status": 200, "body": "{\"checkout_url\":\"https://checkout.stripe.com/…\"}" }, "screenshot": "screenshots/05-checkout-redirect.png" },
    { "id": "use",        "result": "PASS", "human_interventions": 0, "quote": "One metered call succeeded; the limit returned 429 with Retry-After.", "http": { "method": "POST", "url": "https://staging.example.dev/v1/generate", "status": 200 } },
    { "id": "manage",     "result": "SKIP", "human_interventions": 0 }
  ],
  "findings": [
    { "flow": "pay", "grade": "F-high", "text": "POST /billing/change-plan returns checkout_url; no payment_method parameter accepted.", "command": "POST https://staging.example.dev/billing/change-plan", "docLine": "docs/billing#upgrade", "fix": "Accept a saved payment_method id (SetupIntent) and return the subscription; keep checkout_url as a 402 fallback." },
    { "flow": "use", "grade": "F-low", "text": "429 body has no retry_after field; header is present.", "command": "POST https://staging.example.dev/v1/generate → 429" }
  ],
  "worked": ["One-call signup with key in response", "Cross-account read correctly 403"],
  "human_interventions": 0,
  "human_assist": false
}
```

Rules:
- `mode` is `smoke` (scripted walk, no submits) or `full` (you acted as the agent).
- One flow per stage id: `discover`, `understand`, `signup`, `access`, `pay`, `use`, `manage`. `SKIP` for stages not reached.
- `human_interventions` counts every time a person had to do something (click an email link, solve a CAPTCHA, paste a card). A `PASS` with interventions > 0 becomes `HUMAN_REQUIRED`.
- A `FAIL` needs an `http` exchange to count as `BLOCKED`. A failure you can only describe from a browser click, with no request recorded, is downgraded to `HUMAN_REQUIRED` until a second run confirms it.
- `quote` is one or two sentences in your own voice at that moment. It leads the report for the stalled stage. Be plain: what you tried, what came back, why you stopped.
- `screenshot` paths are relative to the run directory; the report embeds them.
- `human_assist` is true if you read the product's source or got help outside the documented surfaces; mark anything learned that way `[assisted]` in `quote` or finding text.
