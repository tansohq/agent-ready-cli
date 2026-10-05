# Dev Readiness Patterns

## Gold Standard: Stripe Error Responses

Every Stripe error returns:
```json
{
  "error": {
    "type": "card_error",
    "code": "card_declined",
    "decline_code": "insufficient_funds",
    "message": "Your card has insufficient funds.",
    "param": "payment_method",
    "request_log_url": "https://dashboard.stripe.com/logs/req_..."
  }
}
```

Why this works for agents:
- `type` — category (card, validation, API, authentication, rate limit)
- `code` — machine-parseable specific error
- `param` — which field to fix
- `message` — human-readable explanation
- Every response includes a `Request-Id` header for tracing

The emerging best practice extends this with agent-actionable fields (from RFC 9457 Problem Details):
- `is_retriable` — boolean, should the agent retry?
- `retry_after_seconds` — numeric, when to retry
- `documentation_url` — link to recovery guidance
- `alternative_action` — what else the agent can do

Anti-pattern: HTML 500 page, `{"error": "something went wrong"}`, error messages without codes.

---

## Gold Standard: Stripe Idempotency

```
POST /v1/charges
Idempotency-Key: unique-key-from-client
```

Rules:
- 24-hour dedup window
- Replay returns the original response (same status, same body)
- Keys are scoped to the API key that made the request
- POST/PATCH/DELETE support it; GET doesn't need it

Why this matters for agents: agents operate in unreliable environments (network timeouts, process restarts, rate limits). Without idempotency, a retry after a timeout means "did the charge go through? Do I charge again? Do I check first?" With idempotency, retry is always safe.

Reconciliation path: return entity IDs and relevant metadata after mutations. Provide lookup-by-client-reference endpoints so agents can verify state after failures.

---

## Gold Standard: Cursor-Based Pagination

Stripe:
```
GET /v1/customers?limit=10&starting_after=cus_abc123
→ { "data": [...], "has_more": true }
```

Why cursor > offset for agents:
- Offset breaks when items are added/removed between pages (items get skipped or duplicated)
- Cursor is stable — always picks up where you left off
- Agents paginate programmatically; they WILL hit the offset bug eventually

Anti-pattern: `?page=2&per_page=10` with no cursor alternative.

---

## Gold Standard: Stripe Date-Based Versioning

```
Stripe-Version: 2024-04-10
```

- Account pins to the API version at signup
- Explicit header overrides the pin
- Breaking changes get a new version date
- Old versions supported for years (not months)
- Upgrade guide per version with exact changes

Why this works: agents pin a version and never break. New agents start on the latest. No silent breaking changes. Contrast with: unversioned APIs where an update breaks all clients simultaneously.

---

## MCP Server Design Patterns

### Tool Naming
Use `{service}_{action}_{resource}` in snake_case. Example: `slack_send_message` not `send_message`. Service prefix avoids collisions when multiple MCP servers operate together. Most production MCP servers use snake_case.

### Tool Descriptions
Write for AI agents, not humans. "Use this when the user wants to view a customer's billing history" beats "Gets billing data." Descriptions must narrowly and unambiguously describe functionality. This is the single most important factor in whether agents select the right tool.

### Curated Tool Surface
A focused set of 10-15 well-designed tools is far more useful than 100 tools where the agent cannot figure out which one to call. This finding appears independently across Stripe, Apideck, Zuplo, and freeCodeCamp sources.

Anti-pattern: auto-generating one MCP tool per API endpoint for a 200-endpoint API. Cloudflare's approach for large APIs: two tools (`search()` and `execute()`) where the model writes code against a typed representation of the API spec.

### Error Handling
Report tool errors within result objects (`isError: true` in content), NOT as MCP protocol-level errors. This allows the LLM to see and potentially recover from errors. Include machine-readable codes plus brief explanations.

Input validation errors should be returned as Tool Execution Errors (not Protocol Errors) to enable model self-correction.

### Pagination
Cursor-based with `has_more`/`next_cursor` metadata. Default to 20-50 items per response. Never load all results into memory. Offer both `list` (recent items) and `search` (filtered) tools — agents struggle with multi-page iteration but excel at describing search criteria.

### Tool Annotations
Provide `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. These are hints, not security guarantees, but they help agents and permission systems make safe decisions.

### Response Format
Support both JSON (programmatic processing) and Markdown (readability). Convert timestamps to human-readable format. Show display names with IDs in parentheses.

### Authentication
OAuth 2.1 with PKCE is required for remote public MCP servers. Additional requirements: Dynamic Client Registration (DCR), Protected Resource Metadata (RFC 9728), Resource Indicators (RFC 8707). For internal/personal servers, static Bearer tokens or API keys are acceptable.

Key principle: MCP servers act as OAuth resource servers (validate tokens, don't issue them). Separate resource server from authorization server.

### MCP and OpenAPI — The Relationship
MCP quality is capped by underlying API/OpenAPI quality. Auto-generation tools (Stainless, FastMCP, Zuplo, Speakeasy) handle mechanical translation from OpenAPI to MCP tools. But: vague operation IDs become vague tool names, missing parameter descriptions become agent hallucinations, absent error documentation becomes invisible failures.

Good MCP servers start from good APIs with comprehensive OpenAPI specs.

---

## A2A Agent Card

Google A2A (Agent-to-Agent) protocol. Donated to Linux Foundation in 2025. Major supporting organizations include AWS, Cisco, Google, IBM, Microsoft, Salesforce, SAP.

Every A2A-compatible agent publishes a machine-readable JSON Agent Card:
```json
{
  "name": "Billing Agent",
  "description": "Manages subscriptions and invoices",
  "provider": { "organization": "Acme Corp" },
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    { "name": "manage_subscription", "description": "Create, update, or cancel subscriptions" }
  ],
  "securitySchemes": ["apiKey", "oauth2"],
  "signature": "sha256:base64..."
}
```

### Task Lifecycle
Tasks progress: `SUBMITTED` → `WORKING` → `COMPLETED`/`FAILED`/`CANCELED`/`REJECTED`. Two interrupted states: `INPUT_REQUIRED` (needs clarification) and `AUTH_REQUIRED` (needs authentication). Terminal states close the task; interrupted states allow resumption.

### Error Format
JSON-RPC 2.0. Errors carry machine-readable code, human-readable message, and error details array with `@type` field. Named error types: `TaskNotFoundError`, `PushNotificationNotSupportedError`, `VersionNotSupportedError`.

### Streaming
Server-Sent Events (SSE). Events: `task`, `message`, `statusUpdate`, `artifactUpdate`. Stream MUST close on terminal state.

### Layering
A2A sits on top of APIs and MCP. Don't recommend A2A unless the product already has solid APIs. The progression: REST API → MCP server → A2A Agent Card.

---

## Agent Toolkit Pattern

### Gold Standard: Stripe Agent Toolkit

The `@stripe/agent-toolkit` demonstrates what agent-first SDK design looks like:
- **Curated operations** — not the full API surface. 10-20 operations that make sense for autonomous use.
- **Framework-native** — works with OpenAI Agents SDK, Vercel AI SDK, LangChain, CrewAI. Single `toolkit.get_tools()` call returns framework-compatible tool definitions.
- **Permission scoping** — restricted API keys (`rk_*`) limit agent access. Developers control exactly which operations an agent can perform. Read-only mode is trivial.
- **Sandbox-first** — test in sandbox before production. Agent behavior is non-deterministic; run evaluations.

Anti-pattern: dumping every API endpoint as a tool. Agents facing 100+ tools cannot reliably select the right one. Tool descriptions count as input tokens on every request — a bloated tool list adds thousands of tokens per call.

---

## llms.txt

Markdown file at `/llms.txt` with curated links to highest-value technical content. Companion `/llms-full.txt` contains complete embedded documentation.

Who ships it: Anthropic, Stripe, Cursor, Cloudflare, Vercel, Mintlify, Supabase, LangGraph.

Format:
```markdown
# Product Name

> One-line description of the API

## Authentication
- [API Keys](https://docs.example.com/auth/api-keys)
- [OAuth](https://docs.example.com/auth/oauth)

## Core Endpoints
- [Create Customer](https://docs.example.com/api/customers/create)
- [List Invoices](https://docs.example.com/api/invoices/list)

## Error Handling
- [Error Codes](https://docs.example.com/errors)
```

Anti-patterns: marketing language, navigation menus, CSS/JS, stale content, generic placeholder values. This is for machines and coding agents, not humans browsing.

---

## Time-to-First-Call

The north star metric for dev readiness. How many steps from zero to working API request?

| Product | Steps | Time | What Makes It Fast |
|---------|-------|------|--------------------|
| Stripe | 3 | ~2 min | Signup → test key in dashboard → curl with key |
| CopilotKit | 4 | ~2 min | CLI scaffolding → set env var → npm install → run |
| Twilio | 4 | ~5 min | Signup → trial number → install SDK → send SMS |

What slows it down:
- Multi-step approval process
- Email verification before API access
- SDK requires complex configuration
- Quickstart has missing steps or assumes prior setup
- Test mode requires separate application

---

## Test Mode / Sandbox Patterns

### Stripe
- `sk_test_*` keys, separate from production
- Test card numbers (4242... = success, 4000... = decline)
- Test clocks for subscription billing simulation
- Up to 5 team sandboxes
- API objects in sandbox aren't accessible from live mode

### Cloudflare
- V8 isolate-based Dynamic Workers for ephemeral code execution (millisecond start)
- Full container-based Sandboxes for complete Linux environments
- Credential injection via egress proxy
- Snapshot-based session recovery

Pattern: test environments should be provisionable and tearable programmatically, isolated from production, with fixtures that simulate edge cases (failures, delays, rate limits).

---

## Rate Limiting for Agent Traffic

Agents don't pause like humans — they fire requests at network speed. Traditional per-user rate limits assume human-shaped traffic and break under agent load.

### Required Headers
- `X-RateLimit-Remaining`, `X-RateLimit-Limit`, `X-RateLimit-Reset`
- `Retry-After` on 429 responses (specific seconds, not just "try later")
- Include rate limit info in JSON body too (not just headers)

### Agent-Specific Patterns
- Token bucket per identity (not just per-IP)
- Cost-based quotas — count resource consumption, not just API calls
- Batch/bulk endpoints to reduce request volume
- Circuit breakers for runaway loops (consecutive 429s, error rate threshold, cost-velocity ceiling)

---

## What Blocks Integration

| Anti-Pattern | Why It Kills Agents | Why It Kills Developers | Fix |
|---|---|---|---|
| HTML error pages | Unparseable | Hard to debug programmatically | Structured JSON errors with type + code |
| `{"error": "something went wrong"}` | Can't self-correct | No actionable info | Include code, param, and suggestion |
| No request IDs | Can't trace failures | Support can't help | `X-Request-Id` on every response |
| No idempotency | Retries cause duplicates | Manual dedup logic | `Idempotency-Key` header |
| Offset pagination | Skips/duplicates items | Inconsistent data | Cursor-based with `has_more` |
| Unversioned API | Silent breakage | Unexpected regressions | Pinnable versions + deprecation policy |
| No test mode | Must use production | Risk of real charges | Test keys + test fixtures |
| No OpenAPI spec | Can't auto-discover endpoints | Manual integration | Publish and version the spec |
| 100-tool MCP server | Can't select right tool | Overwhelming, token-expensive | Curate to 10-15 tools |
| No llms.txt | Can't parse marketing docs | Must read raw HTML | Publish technical llms.txt |
| No `Retry-After` on 429 | Guesses backoff, gets banned | Trial-and-error rate handling | Specific seconds in header |

## Minimum Viable DX Checklist

The smallest set of changes that makes an API dev-ready for humans AND agents:

1. **Structured errors** — JSON with type, code, message, param on every error response
2. **Request IDs** — `X-Request-Id` header on every response
3. **Idempotency** — accept and honor `Idempotency-Key` on POST/PATCH/DELETE
4. **Cursor pagination** — `starting_after` + `has_more` on list endpoints
5. **API versioning** — pin via header, deprecation policy published
6. **OpenAPI spec** — complete, versioned, published at a well-known URL
7. **Test mode** — separate keys, test fixtures, isolated from production
8. **Retry-After** — include on 429 responses with specific backoff time
9. **llms.txt** — curated technical content at domain root
10. **Quickstart** — zero to first API call in under 5 minutes
