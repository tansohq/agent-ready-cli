// ONE task against ONE product. The executor never sees `evaluate`; the evaluator never reads the executor's words.
// Two modes. signup: the agent must obtain its own test-mode key by signing up as the persona (creates an account).
// given: STRIPE_RESTRICTED_KEY is injected and acquire_credential is skipped. Live keys are never used.

export const task = {
  id: "stripe-subscription",
  url: "https://stripe.com",
  apiHost: "api.stripe.com",
  credentialEnvName: "STRIPE_API_KEY",
  text: "Create a customer and subscribe them to a monthly $10 USD plan using the Stripe API.",
  credentials: [
    {
      env: "STRIPE_RESTRICTED_KEY",
      injectAs: "STRIPE_API_KEY",
      test: /^(sk|rk)_test_/,
      rejectReason: "must be a Stripe test-mode key (sk_test_ or rk_test_); live keys are never used",
      description: "Stripe test-mode restricted key with write access to Customers, Products, Prices, Subscriptions",
    },
  ],
  // Outbound network the executor may reach. First-party docs, the dashboard for signup, the test API.
  network: ["stripe.com", "docs.stripe.com", "api.stripe.com", "dashboard.stripe.com", "m.stripe.com", "js.stripe.com", "b.stripecdn.com"],
  instructions: {
    always: [
      "Work only inside the current directory. Do not touch other directories.",
      "Write PLAN.md first: which interface you will use, where you learned how to authenticate (URL), and the exact steps. Then act.",
      "Set metadata agent_ready_run=<runId> on every object you create so the run can be audited and cleaned up.",
      "Do not decide or state whether you succeeded. When you have done what you can, stop.",
    ],
    withCredential: ["A Stripe test-mode API key is in the environment variable STRIPE_API_KEY. Use it. Never print it or write it to a file."],
    signup: [
      "You have no API key. Obtain one yourself: create a Stripe account as the persona below, using only what the product's own pages and your inbox give you. Use test mode / sandbox keys only; never live keys.",
      "When you have a key, write it to CREDENTIAL.env as a single line STRIPE_API_KEY=<key> and nowhere else, then continue with the task using it.",
      "If you reach a step no agent can pass without a human (CAPTCHA, phone verification, identity or business documents, payment details), write NEEDS_HUMAN.md stating the exact step, the URL, and what it asked for, then stop. Do not try to bypass it.",
    ],
    withoutCredential: [
      "No credential is available for this run. Do not invent, guess or ask for one.",
      "Go as far as the documentation allows: read it, write PLAN.md, and write the exact requests you would make as request.sh using $STRIPE_API_KEY as a placeholder.",
      "When you cannot proceed without a credential, write NEEDS_CREDENTIAL.md stating which credential, the URL where you learned how it is obtained and sent, and the first request that needs it. Then stop.",
    ],
  },
  criteria: {
    local: ["PLAN.md exists and names an interface and an authentication source URL", "signup mode: CREDENTIAL.env holds a test-mode key that authenticates, or NEEDS_HUMAN.md names the blocking step and URL"],
    live: ["a customer exists with metadata agent_ready_run=<runId>", "a subscription exists for that customer with metadata agent_ready_run=<runId>, status active or trialing", "that subscription has exactly one item whose price is 1000 USD recurring monthly"],
  },
};

async function stripe(key, path) {
  const res = await fetch(`https://api.stripe.com${path}`, { signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${key}` } });
  const body = await res.json();
  return { status: res.status, body };
}

// Deterministic. Local checks read the scratch directory; live checks read Stripe state with whichever test key
// the run has: injected, or obtained by the agent and written to CREDENTIAL.env.
export async function evaluate({ runId, files, credentials, mode }) {
  const checks = [];
  const plan = files.read("PLAN.md");
  const planUrl = plan ? (plan.match(/https?:\/\/[^\s)>\]]+/) || [null])[0] : null;
  checks.push({ id: "plan_written", tier: "local", pass: Boolean(plan && /\bAPI\b|\bMCP\b|\bCLI\b/i.test(plan) && planUrl), detail: plan ? `PLAN.md ${plan.length} chars; interface ${(plan.match(/\bMCP\b|\bCLI\b|\bAPI\b/i) || ["not named"])[0]}; auth source ${planUrl || "no URL"}` : "no PLAN.md", evidence: { file: "PLAN.md" } });

  let key = credentials.has("STRIPE_API_KEY") ? credentials.value("STRIPE_API_KEY") : null;
  if (mode === "signup") {
    const cred = files.readRaw("CREDENTIAL.env");
    const found = cred ? (cred.match(/STRIPE_API_KEY=([^\s]+)/) || [])[1] : null;
    const human = files.read("NEEDS_HUMAN.md");
    const humanUrl = human ? (human.match(/https?:\/\/(?:[a-z0-9-]+\.)*stripe\.com[^\s)>\]]*/i) || [null])[0] : null;
    if (found && /^(sk|rk)_test_/.test(found)) {
      const probe = await stripe(found, "/v1/customers?limit=1");
      const works = probe.status === 200;
      checks.push({ id: "credential_acquired", tier: "local", pass: works, detail: works ? "agent obtained a test-mode key that authenticates (GET /v1/customers 200)" : `agent wrote a key but Stripe returned ${probe.status}`, evidence: { file: "CREDENTIAL.env", request: "GET /v1/customers?limit=1", status: probe.status } });
      if (works) key = found;
    } else if (found) checks.push({ id: "credential_acquired", tier: "local", pass: false, detail: "CREDENTIAL.env holds a key that is not test-mode; not used", evidence: { file: "CREDENTIAL.env" } });
    else checks.push({ id: "credential_acquired", tier: "local", pass: false, status: human ? "human_required" : "not_acquired", detail: human ? `stopped at a human-only step: ${human.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 140) || "see NEEDS_HUMAN.md"}${humanUrl ? ` (${humanUrl})` : ""}` : "no key obtained and no NEEDS_HUMAN.md", evidence: { file: human ? "NEEDS_HUMAN.md" : null } });
  }

  if (!key) {
    if (mode !== "signup") {
      const needs = files.read("NEEDS_CREDENTIAL.md");
      const needsUrl = needs ? (needs.match(/https?:\/\/(?:[a-z0-9-]+\.)*stripe\.com[^\s)>\]]*/i) || [null])[0] : null;
      checks.push({ id: "credential_need_documented", tier: "local", pass: Boolean(needs && needsUrl), detail: needs ? `NEEDS_CREDENTIAL.md cites ${needsUrl || "no first-party URL"}` : "no NEEDS_CREDENTIAL.md", evidence: { file: "NEEDS_CREDENTIAL.md" } });
    }
    const why = mode === "signup" ? "no working key was acquired" : "needs STRIPE_RESTRICTED_KEY to read Stripe state";
    for (const id of ["customer_created", "subscription_active", "price_matches"]) checks.push({ id, tier: "live", pass: null, status: "credential_required", detail: why, evidence: null });
    return { method: "deterministic", checkedAt: new Date().toISOString(), success: false, stoppedAt: "credential_required", checks, authenticated: null, objects: null, keySource: null };
  }

  const q = encodeURIComponent(`metadata['agent_ready_run']:'${runId}'`);
  const customers = await stripe(key, `/v1/customers/search?query=${q}`);
  if (customers.status === 401 || customers.status === 403) {
    for (const id of ["customer_created", "subscription_active", "price_matches"]) checks.push({ id, tier: "live", pass: null, status: "evaluator_auth_failed", detail: `Stripe returned ${customers.status} to the evaluator; the key cannot read this account`, evidence: { request: `GET /v1/customers/search`, status: customers.status } });
    return { method: "deterministic", checkedAt: new Date().toISOString(), success: false, stoppedAt: "evaluator_auth_failed", checks, authenticated: null, objects: null, keySource: mode === "signup" ? "agent" : "injected" };
  }
  const customer = customers.body?.data?.[0] || null;
  checks.push({ id: "customer_created", tier: "live", pass: Boolean(customer), detail: customer ? `customer ${customer.id}` : `no customer tagged ${runId} (HTTP ${customers.status})`, evidence: { request: `GET /v1/customers/search?query=metadata['agent_ready_run']:'${runId}'`, status: customers.status, count: customers.body?.data?.length ?? null } });

  const subs = await stripe(key, `/v1/subscriptions/search?query=${q}`);
  const sub = subs.body?.data?.find((s) => !customer || s.customer === customer.id) || subs.body?.data?.[0] || null;
  checks.push({ id: "subscription_active", tier: "live", pass: Boolean(sub && ["active", "trialing"].includes(sub.status)), detail: sub ? `subscription ${sub.id} status ${sub.status}` : `no subscription tagged ${runId} (HTTP ${subs.status})`, evidence: { request: `GET /v1/subscriptions/search?query=metadata['agent_ready_run']:'${runId}'`, status: subs.status, count: subs.body?.data?.length ?? null } });

  let priceOk = false;
  let priceDetail = "no subscription to inspect";
  if (sub) {
    const items = sub.items?.data || [];
    const p = items[0]?.price;
    priceOk = items.length === 1 && p && p.currency === "usd" && p.unit_amount === 1000 && p.recurring?.interval === "month" && (p.recurring?.interval_count ?? 1) === 1;
    priceDetail = `${items.length} item(s); first price ${p ? `${p.unit_amount} ${p.currency} / ${p.recurring?.interval_count ?? 1} ${p.recurring?.interval}` : "none"}`;
  }
  checks.push({ id: "price_matches", tier: "live", pass: Boolean(priceOk), detail: priceDetail, evidence: sub ? { request: `GET /v1/subscriptions/${sub.id} (embedded items)`, priceId: sub.items?.data?.[0]?.price?.id ?? null } : null });

  return { method: "deterministic", checkedAt: new Date().toISOString(), success: checks.filter((c) => c.tier === "live").every((c) => c.pass === true), stoppedAt: null, checks, authenticated: Boolean(customer), objects: { customer: customer?.id ?? null, subscription: sub?.id ?? null }, keySource: mode === "signup" ? "agent" : "injected" };
}
