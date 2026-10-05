// ONE task against a self-hosted tanso-oss instance, end to end: discover from the host name, sign up with no
// email, use the free plan, upgrade to a paid plan, hand the payment link to a human, wait until it is paid.
// The agent is told only the base URL. The evaluator reads Tanso's own API with the key the agent obtained.

const BASE = process.env.TANSO_BASE_URL || "http://localhost:8093";
const HOST = new URL(BASE).hostname;

export const task = {
  id: "tanso-oss",
  url: BASE,
  apiHost: new URL(BASE).host,
  credentialEnvName: "TANSO_API_KEY",
  text:
    "Get this product's billing API working for yourself as a customer: sign up, confirm you are entitled to the ai.chat feature, " +
    "record one ai.chat usage event, then move to the paid plan with the key starter. A human pays for it. When you are done, " +
    "your account should be on the starter plan and paid for.",
  credentials: [],
  network: [HOST, "127.0.0.1"],
  instructions: {
    always: [
      "Work only inside the current directory. Do not touch other directories.",
      `You are given only the base URL ${BASE}. Find out how to use it from what it publishes. Do not guess endpoints from memory.`,
      "Write PLAN.md first: which interface you will use, where you learned how to sign up and authenticate (URL), and the exact steps. Then act.",
      "Do not decide or state whether you succeeded. When you have done what you can, write RESULT.md with what you did and stop.",
    ],
    withCredential: [],
    signup: [
      "You have no API key. Obtain one yourself through the product's own signup, as the persona below.",
      "When you have a key, write CREDENTIAL.env with two lines, TANSO_API_KEY=<key> and TANSO_CUSTOMER_REF=<your customer reference id>, and write the key nowhere else. Never print it.",
      "In RESULT.md include a line `Email requirement: <none|agent_email|human_email|product_issued>` describing what signup asked for.",
      "If a step needs a human (payment, an email address you cannot provide, identity), write NEEDS_HUMAN.md with the exact step, the URL the human must open, and what they must do. " +
        "Then do not stop: poll the product every 20 seconds (sleep 20 between requests) for up to 15 minutes until the step is done, then continue. " +
        "If it is still not done after 15 minutes, write that in RESULT.md and stop.",
      "The human reads NEEDS_HUMAN.md only once per new URL, so write it again with the new link if the product gives you a different one.",
    ],
    withoutCredential: ["No credential is available for this run. Do not invent one. Write NEEDS_CREDENTIAL.md and stop."],
  },
  criteria: {
    local: ["PLAN.md exists and cites a first-party URL on the instance", "CREDENTIAL.env holds a customer key (ck_) that authenticates"],
    live: [
      "the agent's customer has at least one ai.chat usage event",
      "the agent's customer is on the starter plan and that subscription is active",
      "the agent's customer is claimed (paid)",
    ],
  },
};

async function tanso(key, path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000), headers: { "X-API-Key": key } });
  const text = await res.text();
  let body = null;
  let jsonError = null;
  try {
    body = JSON.parse(text);
  } catch (err) {
    // Kept as null so the checks below read "no data", but the reason travels into the check's evidence.
    jsonError = `HTTP ${res.status} body is not JSON (${err.message}): ${text.slice(0, 200)}`;
  }
  return { status: res.status, body, jsonError };
}

/**
 * True when the agent's trace shows a POST to the events endpoint that came back 201. Read from the command it
 * ran and the result that call returned, not from the task text, which also names the endpoint.
 */
export function eventAccepted(traceText) {
  const posted = new Set();
  for (const line of traceText.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const blocks = entry?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block.type === "tool_use") {
        const command = typeof block.input?.command === "string" ? block.input.command : "";
        if (/\/api\/v1\/client\/events/.test(command) && /-X\s*POST|--request\s*POST/i.test(command)) posted.add(block.id);
      }
      if (block.type === "tool_result" && posted.has(block.tool_use_id)) {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content || "");
        if (/\b201\b/.test(text)) return true;
      }
    }
  }
  return false;
}

// Deterministic. Local checks read the scratch directory; live checks read Tanso state with the key the agent obtained.
export async function evaluate({ files }) {
  const checks = [];
  const plan = files.read("PLAN.md");
  const planUrl = plan ? (plan.match(/https?:\/\/[^\s)>\]`]+/) || [null])[0] : null;
  checks.push({ id: "plan_written", tier: "local", pass: Boolean(plan && planUrl), detail: plan ? `PLAN.md cites ${planUrl || "no URL"}` : "no PLAN.md", evidence: { file: "PLAN.md" } });

  const cred = files.readRaw("CREDENTIAL.env");
  const key = cred ? (cred.match(/TANSO_API_KEY=([^\s]+)/) || [])[1] : null;
  // A customer key only reads its own customer, so a wrong reference fails here instead of being trusted.
  const claimedRef = cred ? (cred.match(/TANSO_CUSTOMER_REF=([^\s]+)/) || [])[1] : null;
  const result = files.read("RESULT.md") || "";
  // The agent's own command log: what it sent and what came back.
  const traceText = files.readRaw("trace.jsonl") || "";
  const emailRequirement = (result.match(/Email requirement:\s*`?([a-z_]+)/i) || [])[1] || null;
  const human = files.read("NEEDS_HUMAN.md");

  let status = null;
  if (key && /^ck_/.test(key)) {
    checks.push({ id: "credential_acquired", tier: "local", pass: true, detail: "agent wrote a customer key (ck_) to CREDENTIAL.env", evidence: { file: "CREDENTIAL.env" } });
    const probe = await tanso(key, `/api/v1/client/customers/${encodeURIComponent(claimedRef || "missing")}/status`);
    const ref = probe.body?.data?.customerReferenceId || null;
    status = ref ? probe : null;
    checks.push({ id: "credential_works", tier: "local", pass: Boolean(ref), detail: ref ? `customer key authenticates as ${ref} (GET status 200)` : `key did not authenticate (HTTP ${probe.status}${probe.jsonError ? `; ${probe.jsonError}` : ""})`, evidence: { request: "GET /api/v1/client/customers/{ref}/status", status: probe.status, jsonError: probe.jsonError } });
  } else {
    checks.push({ id: "credential_acquired", tier: "local", pass: false, status: human ? "human_required" : "not_acquired", detail: key ? "CREDENTIAL.env holds something that is not a customer key" : "no key obtained", evidence: { file: human ? "NEEDS_HUMAN.md" : "CREDENTIAL.env" } });
  }

  if (!status) {
    for (const id of ["usage_recorded", "on_starter_and_active", "claimed"]) checks.push({ id, tier: "live", pass: null, status: "credential_required", detail: "no working key", evidence: null });
    const stoppedAt = key && /^ck_/.test(key) ? "credential_rejected" : "credential_required";
    return { method: "deterministic", checkedAt: new Date().toISOString(), success: false, stoppedAt, checks, authenticated: false, observed: { emailRequirement, humanGate: human ? "payment" : null } };
  }

  const data = status.body.data;
  const ref = data.customerReferenceId;
  const usage = await tanso(key, `/api/v1/client/customers/${ref}/usage`);
  const used = (usage.body?.data?.subscriptions || []).flatMap((s) => s.features || []).reduce((n, f) => n + Number(f.used || 0), 0);
  // Usage the agent recorded on the plan it started on is not visible here once that subscription is retired by
  // the upgrade, so the agent's own trace counts too: a POST to the events endpoint answered 201.
  const recorded = eventAccepted(traceText);
  checks.push({ id: "usage_recorded", tier: "live", pass: used >= 1 || recorded, detail: used >= 1 ? `${used} unit(s) used across the plans the customer is on` : recorded ? "usage recorded (POST /events 201 in the trace); the plan it was recorded on was retired by the upgrade, which drops it from the usage summary" : "no usage recorded and none visible in the usage summary", evidence: { request: `GET /api/v1/client/customers/${ref}/usage`, status: usage.status, jsonError: usage.jsonError } });

  const onStarter = (usage.body?.data?.subscriptions || []).some((s) => s.planKey === "starter");
  checks.push({ id: "on_starter_and_active", tier: "live", pass: onStarter && data.plan === "starter", detail: `status reports plan ${data.plan}; active subscriptions: ${(usage.body?.data?.subscriptions || []).map((s) => s.planKey).join(", ") || "none"}`, evidence: { request: `GET /api/v1/client/customers/${ref}/status` } });
  checks.push({ id: "claimed", tier: "live", pass: data.status === "claimed", detail: `customer status ${data.status}, claimed_at ${data.claimed_at}`, evidence: { request: `GET /api/v1/client/customers/${ref}/status` } });

  return {
    method: "deterministic",
    checkedAt: new Date().toISOString(),
    success: checks.filter((c) => c.tier === "live").every((c) => c.pass === true),
    stoppedAt: null,
    checks,
    authenticated: true,
    observed: { emailRequirement, humanGate: human ? "payment" : null, customerReferenceId: ref },
    objects: { customer: ref },
    keySource: "agent",
  };
}
