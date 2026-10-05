const env = (kind, extra = {}) => ({
  schema: `agent-ready/${kind}@1`,
  runId: "test-run",
  target: { url: "https://example.dev" },
  startedAt: "2026-09-09T00:00:00.000Z",
  finishedAt: "2026-09-09T00:01:00.000Z",
  provider: { name: kind, version: "0.0.0" },
  available: true,
  ...extra,
});

export function scanFixture(overrides = {}) {
  return env("scan", {
    aeo: {
      url: "https://example.dev",
      timestamp: "2026-09-09T00:00:00.000Z",
      averageScore: 71,
      benchmarks: {
        agenticSeo: { score: 80, maxScore: 100, grade: "B", categories: null, available: true },
        cloudflare: {
          score: 4,
          maxScore: 5,
          grade: "B",
          categories: {},
          available: true,
          checks: [
            { id: "robotsTxt", status: "pass", message: "" },
            { id: "sitemap", status: "pass", message: "" },
            { id: "markdownForAgents", status: "fail", message: "No markdown served" },
          ],
        },
        fern: { available: false, reason: "timeout" },
        vercel: null,
        agentgrade: { score: 60, maxScore: 100, grade: "C", categories: {}, available: true, checks: [{ id: "mcp-server", status: "warn", message: "no MCP server card" }] },
      },
    },
    probes: [
      { id: "robots_ai", status: "pass", detail: "AI bots allowed" },
      { id: "llms_txt", status: "pass", detail: "/llms.txt 200" },
      { id: "captcha", status: "fail", detail: "reCAPTCHA script on /signup" },
      { id: "signup_endpoint", status: "warn", detail: "POST /signup returns HTML" },
      { id: "pricing_json", status: "fail", detail: "/pricing.json 404" },
      { id: "http_402", status: "skip", detail: "not probed" },
    ],
    ...overrides,
  });
}

export function auditFixture(overrides = {}) {
  const area = (score, today, blocks = [], build = "build it") => ({ score, today, blocks, build, effort: "M" });
  return env("audit", {
    areas: {
      onboarding: area(8, "POST /v1/accounts exists", [], "none"),
      authentication: area(8, "scoped keys", [], "none"),
      purchasing: area(3, "browser checkout only", ["checkout requires Stripe hosted page"], "SetupIntent + POST /subscriptions"),
      usage_monitoring: area(5, "daily aggregates", ["no rate limit headers"], "add headers"),
      self_management: area(2, "dashboard only", ["no cancel endpoint"], "add PATCH /subscriptions"),
      dev_readiness: area(7, "structured errors", [], "add idempotency keys"),
    },
    hard_blockers: [{ area: "purchasing", text: "Plan change returns checkout_url" }],
    quick_wins: [{ area: "usage_monitoring", text: "Add X-RateLimit-* headers" }],
    roadmap: ["SetupIntent"],
    maturity: 2,
    ...overrides,
  });
}

export function crashFixture(overrides = {}) {
  return env("crash", {
    mode: "full",
    persona: "agent with task and budget",
    task: "sign up and make one metered call on a paid plan",
    flows: [
      { id: "discover", result: "PASS", human_interventions: 0 },
      { id: "understand", result: "PASS", human_interventions: 0 },
      { id: "signup", result: "PASS", human_interventions: 0, http: { method: "POST", url: "/v1/accounts", status: 201 } },
      { id: "access", result: "PASS", human_interventions: 0 },
      { id: "pay", result: "FAIL", human_interventions: 0, quote: "checkout needs a browser", http: { method: "POST", url: "/billing/change-plan", status: 200 } },
      { id: "use", result: "SKIP", human_interventions: 0 },
      { id: "manage", result: "SKIP", human_interventions: 0 },
    ],
    findings: [{ flow: "pay", grade: "F-high", text: "Plan change returns checkout_url", command: "POST /billing/change-plan" }],
    worked: ["one-call signup"],
    human_interventions: 0,
    human_assist: false,
    ...overrides,
  });
}
