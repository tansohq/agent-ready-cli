// One task shape for products that claim agents can sign themselves up: obtain a credential as the persona, then
// prove it with one authenticated read. The deterministic check is the same read, made by the evaluator with the
// key the agent wrote to CREDENTIAL.env. Nothing is purchased; nothing needs a human unless the product demands it.

export function defineSignupTask({ id, name, url, docsHint = null, apiHost, network, credentialEnvName, extraFields = [], keyPattern, verify, emailNote = null, taskText = null, extraInstructions = [], extraLocal = [] }) {
  const task = {
    id,
    url,
    apiHost,
    credentialEnvName,
    text: taskText || `Sign up for ${name} as an agent, obtain an API credential, and make one authenticated read call with it.`,
    credentials: [],
    network,
    instructions: {
      always: [
        "Work only inside the current directory. Do not touch other directories.",
        "Write PLAN.md first: which interface you will use, where you learned how to sign up and authenticate (URL), and the exact steps. Then act.",
        "Use the run id <runId> as the agent name, description, or account name wherever the product asks for one, so the account can be audited.",
        "Do not decide or state whether you succeeded. When you have done what you can, stop.",
      ],
      withCredential: [],
      signup: [
        `You have no credential. Obtain one yourself using only what the product's own pages${docsHint ? ` (start at ${docsHint})` : ""} and your inbox give you. If the product offers a signup path meant for agents, prefer it; your persona email is the human contact address if one is required.`,
        `When you have a credential, write it to CREDENTIAL.env as ${[credentialEnvName, ...extraFields].map((f) => `${f}=<value>`).join(" and ")} (one per line) and nowhere else, then make one authenticated read call with it and record the request and response status in RESULT.md.`,
        ...(emailNote ? [emailNote] : []),
        ...extraInstructions,
        "In RESULT.md include a line starting exactly with \"Email requirement:\" followed by one of: human-email (the product asked for a person's email), agent-email (it accepted your own address as yours), product-issued (it gave you an inbox or identity itself), none (no email was involved); then a short note on what it did with it (OTP, magic link, claim link, nothing). Also a line starting \"Human gate:\" describing what a human would still need to do to keep, expand, or pay for this account, per the product's own pages.",
        "If you reach a step no agent can pass without a human (CAPTCHA meant for humans, phone verification, identity documents, payment details, a tweet), write NEEDS_HUMAN.md stating the exact step, the URL, and what it asked for, then stop. Do not try to bypass it. A challenge the product explicitly designs for agents to solve is not a human step.",
      ],
      withoutCredential: ["No credential is available and signup is not attempted in this mode. Read the documentation, write PLAN.md and NEEDS_CREDENTIAL.md, then stop."],
    },
    criteria: {
      local: ["PLAN.md exists and names an interface and an authentication source URL", `CREDENTIAL.env holds a credential matching ${keyPattern}, or NEEDS_HUMAN.md names the blocking step and URL`],
      live: [`the credential authenticates: ${verify.describe}`],
    },
  };

  async function evaluate({ runId, files, mode }) {
    const checks = [];
    const plan = files.read("PLAN.md");
    const planUrl = plan ? (plan.match(/https?:\/\/[^\s)>\]]+/) || [null])[0] : null;
    checks.push({ id: "plan_written", tier: "local", pass: Boolean(plan && /\bAPI\b|\bMCP\b|\bCLI\b|\bskill\b/i.test(plan) && planUrl), detail: plan ? `PLAN.md ${plan.length} chars; auth source ${planUrl || "no URL"}` : "no PLAN.md", evidence: { file: "PLAN.md" } });
    if (mode !== "signup") {
      checks.push({ id: "credential_need_documented", tier: "local", pass: Boolean(files.read("NEEDS_CREDENTIAL.md")), detail: files.read("NEEDS_CREDENTIAL.md") ? "NEEDS_CREDENTIAL.md written" : "no NEEDS_CREDENTIAL.md", evidence: { file: "NEEDS_CREDENTIAL.md" } });
      checks.push({ id: "credential_works", tier: "live", pass: null, status: "credential_required", detail: "signup not attempted in this mode", evidence: null });
      return { method: "deterministic", checkedAt: new Date().toISOString(), success: false, stoppedAt: "credential_required", checks, authenticated: null, objects: null, keySource: null };
    }
    const cred = files.readRaw("CREDENTIAL.env");
    const fields = Object.fromEntries((cred || "").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\s]+)"?/)).filter(Boolean).map((m) => [m[1], m[2]]));
    const found = fields[credentialEnvName] || null;
    const human = files.read("NEEDS_HUMAN.md");
    if (!found) {
      checks.push({ id: "credential_acquired", tier: "local", pass: false, status: human ? "human_required" : "not_acquired", detail: human ? `stopped at a human-only step: ${human.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 160) || "see NEEDS_HUMAN.md"}` : "no credential obtained and no NEEDS_HUMAN.md", evidence: { file: human ? "NEEDS_HUMAN.md" : null } });
      checks.push({ id: "credential_works", tier: "live", pass: null, status: "credential_required", detail: "no credential to test", evidence: null });
      const md = files.read("RESULT.md") || human || "";
      return { method: "deterministic", checkedAt: new Date().toISOString(), success: false, stoppedAt: human ? "human_required" : "not_acquired", checks, authenticated: null, objects: null, keySource: null, observed: { emailRequirement: (md.match(/^Email requirement:\s*(.+)$/im) || [null, null])[1], humanGate: (md.match(/^Human gate:\s*(.+)$/im) || [null, null])[1] } };
    }
    // The documented key format is a hint, never a gate: the live call decides. A mismatch is recorded, not failed.
    const shape = keyPattern.test(found);
    checks.push({ id: "credential_acquired", tier: "local", pass: true, detail: shape ? `CREDENTIAL.env holds a credential matching the documented format ${keyPattern}` : `CREDENTIAL.env holds a credential that does not match the documented format ${keyPattern} (${found.length} chars, prefix ${found.slice(0, 4)}…)`, evidence: { file: "CREDENTIAL.env" } });
    let result;
    try {
      result = await verify.call(found, runId, fields);
    } catch (err) {
      result = { ok: false, status: 0, detail: `verify call failed: ${err.message}` };
    }
    checks.push({ id: "credential_works", tier: "live", pass: result.ok, detail: result.detail, evidence: { request: verify.describe, status: result.status } });
    for (const x of extraLocal) checks.push({ id: x.id, tier: "local", ...x.check(files) });
    const resultMd = files.read("RESULT.md") || "";
    const emailRequirement = (resultMd.match(/^Email requirement:\s*(.+)$/im) || [null, null])[1];
    const humanGate = (resultMd.match(/^Human gate:\s*(.+)$/im) || [null, null])[1];
    return { method: "deterministic", checkedAt: new Date().toISOString(), success: result.ok, stoppedAt: result.ok ? null : "credential_rejected", checks, authenticated: result.ok, objects: result.objects || null, keySource: "agent", observed: { emailRequirement, humanGate } };
  }

  return { task, evaluate };
}

async function req(url, { method = "GET", headers = {}, body = null } = {}) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  let jsonError = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    // Verify calls that need the JSON report it through their detail; a 200 that is not JSON must not read as "field missing".
    jsonError = `HTTP ${res.status} body is not JSON (${err.message}): ${text.slice(0, 200)}`;
  }
  return { status: res.status, text, json, jsonError };
}

// Products from Kat's list, 2026-09-17. Verify calls and hosts come from each product's own docs (see the
// research notes in examples/). Posterly omitted: no reachable first-party documentation.
export const SIGNUP_TASKS = [
  defineSignupTask({
    id: "stripe-projects",
    name: "Stripe (sandbox, then Projects)",
    url: "https://projects.dev",
    docsHint: "https://docs.stripe.com/projects.md and https://docs.stripe.com/cli.md",
    apiHost: "api.stripe.com",
    network: ["stripe.com", "docs.stripe.com", "api.stripe.com", "ai.stripe.com", "dashboard.stripe.com", "stripe.dev", "projects.dev", "github.com", "api.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com"],
    credentialEnvName: "STRIPE_SANDBOX_KEY",
    extraFields: ["STRIPE_ACCOUNT_ID"],
    keyPattern: /^(rkcs|rk|sk)_test_[A-Za-z0-9]{8,}$/,
    taskText: "Obtain a Stripe sandbox as an agent (the Stripe CLI documents an account-less path), then initialize a Stripe Project with the CLI and add one free provider resource if the product allows it without a human.",
    extraInstructions: [
      "Install the Stripe CLI inside this directory from its GitHub release if it is not on PATH. Test-mode / sandbox keys only; never a live key.",
      "After the sandbox, run the Projects preflight (`stripe projects init --preflight --json`) and record its full JSON in RESULT.md under a line \"Projects preflight:\". If preflight names a blocker only a human can clear (browser sign-in, account eligibility, payment method), record it in NEEDS_HUMAN.md as well, but still keep going with anything the sandbox alone allows.",
    ],
    extraLocal: [
      { id: "projects_initialized", check: (files) => ({ pass: Boolean(files.read(".projects/state.json")), detail: files.read(".projects/state.json") ? ".projects/state.json exists: a Project was initialized" : "no .projects/state.json: Project not initialized", evidence: { file: ".projects/state.json" } }) },
      { id: "projects_preflight_recorded", check: (files) => { const m = (files.read("RESULT.md") || "").match(/Projects preflight:\s*([\s\S]{0,600})/i); return { pass: Boolean(m), detail: m ? m[1].replace(/\s+/g, " ").slice(0, 300) : "no preflight recorded", evidence: { file: "RESULT.md" } }; } },
    ],
    verify: {
      describe: "GET https://api.stripe.com/v1/customers?limit=1 with Authorization: Bearer <sandbox key>",
      call: async (key, runId, f) => {
        const r = await req("https://api.stripe.com/v1/customers?limit=1", { headers: { authorization: `Bearer ${key}` } });
        return { ok: r.status === 200, status: r.status, detail: r.status === 200 ? `customers list 200 (sandbox account ${f.STRIPE_ACCOUNT_ID || "?"})` : `HTTP ${r.status}: ${r.text.slice(0, 120)}`, objects: { accountId: f.STRIPE_ACCOUNT_ID || null } };
      },
    },
  }),
  defineSignupTask({
    id: "cloudflare-signup",
    name: "Cloudflare (temporary account)",
    url: "https://www.cloudflare.com",
    docsHint: "https://developers.cloudflare.com/workers/platform/claim-deployments/",
    apiHost: "api.cloudflare.com",
    network: ["cloudflare.com", "www.cloudflare.com", "developers.cloudflare.com", "blog.cloudflare.com", "api.cloudflare.com", "dash.cloudflare.com", "workers.dev"],
    credentialEnvName: "CLOUDFLARE_API_TOKEN",
    extraFields: ["CLOUDFLARE_ACCOUNT_ID"],
    keyPattern: /^[A-Za-z0-9_-]{20,}$/,
    verify: {
      describe: "GET https://api.cloudflare.com/client/v4/accounts/{account}/workers/subdomain with Authorization: Bearer <token>",
      call: async (key, runId, f) => {
        if (!f.CLOUDFLARE_ACCOUNT_ID) return { ok: false, status: 0, detail: "CREDENTIAL.env has no CLOUDFLARE_ACCOUNT_ID" };
        const r = await req(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(f.CLOUDFLARE_ACCOUNT_ID)}/workers/subdomain`, { headers: { authorization: `Bearer ${key}` } });
        return { ok: r.status === 200 && r.json?.success === true, status: r.status, detail: r.jsonError ? r.jsonError : r.status === 200 ? `subdomain ${r.json?.result?.subdomain ?? "?"}` : `HTTP ${r.status}: ${r.text.slice(0, 120)}`, objects: { accountId: f.CLOUDFLARE_ACCOUNT_ID } };
      },
    },
  }),
  defineSignupTask({
    id: "neon-signup",
    name: "Neon (claimable project)",
    url: "https://neon.com",
    docsHint: "https://neon.com/docs/reference/claimable-neon",
    apiHost: "claimable.neon.tech",
    network: ["neon.com", "neon.tech", "claimable.neon.tech", "github.com", "raw.githubusercontent.com"],
    credentialEnvName: "NEON_IDENTITY_ASSERTION",
    extraFields: ["NEON_PROJECT_ID"],
    keyPattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    verify: {
      describe: "POST https://claimable.neon.tech/v1/oauth2/token (jwt-bearer) then GET /v1/projects/{id}/credentials with the access token",
      call: async (assertion, runId, f) => {
        if (!f.NEON_PROJECT_ID) return { ok: false, status: 0, detail: "CREDENTIAL.env has no NEON_PROJECT_ID" };
        const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion, resource: "https://claimable.neon.tech/" }).toString();
        const t = await req("https://claimable.neon.tech/v1/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        if (t.status !== 200 || !t.json?.access_token) return { ok: false, status: t.status, detail: `token exchange HTTP ${t.status}: ${t.text.slice(0, 120)}` };
        const c = await req(`https://claimable.neon.tech/v1/projects/${encodeURIComponent(f.NEON_PROJECT_ID)}/credentials`, { headers: { authorization: `Bearer ${t.json.access_token}` } });
        return { ok: c.status === 200 && Boolean(c.json?.database_url), status: c.status, detail: c.jsonError ? c.jsonError : c.status === 200 ? `credentials 200; database_url present; expires ${c.json?.expires_at ?? "?"}` : `HTTP ${c.status}: ${c.text.slice(0, 120)}`, objects: { projectId: f.NEON_PROJECT_ID } };
      },
    },
  }),
  defineSignupTask({
    id: "mem0-signup",
    name: "Mem0 (agent mode)",
    url: "https://mem0.ai",
    docsHint: "https://docs.mem0.ai/platform/agent-signup",
    apiHost: "api.mem0.ai",
    network: ["mem0.ai", "docs.mem0.ai", "api.mem0.ai", "app.mem0.ai", "registry.npmjs.org", "pypi.org", "files.pythonhosted.org"],
    credentialEnvName: "MEM0_API_KEY",
    keyPattern: /^m0-[A-Za-z0-9_-]{10,}$/,
    emailNote: "The documented path is a CLI (npm or pip). Installing it inside this directory is allowed; the key it saves to a config file must be copied into CREDENTIAL.env.",
    verify: {
      describe: "GET https://api.mem0.ai/v1/memories/?user_id=<runId> with Authorization: Token <key> (a filter is required)",
      call: async (key, runId) => {
        const r = await req(`https://api.mem0.ai/v1/memories/?user_id=${encodeURIComponent(runId)}&page=1&page_size=1`, { headers: { authorization: `Token ${key}` } });
        return { ok: r.status === 200, status: r.status, detail: r.status === 200 ? `memories list 200 (${r.text.length} bytes)` : `HTTP ${r.status}: ${r.text.slice(0, 120)}` };
      },
    },
  }),
  defineSignupTask({
    id: "cosmic-signup",
    name: "Cosmic (agent signup)",
    url: "https://www.cosmicjs.com",
    docsHint: "https://www.cosmicjs.com/docs/api/agents",
    apiHost: "dapi.cosmicjs.com",
    network: ["cosmicjs.com", "www.cosmicjs.com", "dapi.cosmicjs.com", "api.cosmicjs.com", "app.cosmicjs.com", "mcp.cosmicjs.com"],
    credentialEnvName: "COSMIC_AGENT_KEY",
    keyPattern: /^agk_[A-Za-z0-9_-]{8,}$/,
    verify: {
      describe: "GET https://dapi.cosmicjs.com/v3/agents/status with Authorization: Bearer agk_…",
      call: async (key) => {
        const r = await req("https://dapi.cosmicjs.com/v3/agents/status", { headers: { authorization: `Bearer ${key}` } });
        return { ok: r.status === 200 && Boolean(r.json?.auth_type), status: r.status, detail: r.jsonError ? r.jsonError : r.status === 200 ? `auth_type ${r.json?.auth_type}, claim_status ${r.json?.claim_status}, auto_delete_after_days ${r.json?.auto_delete_after_days ?? "?"}` : `HTTP ${r.status}: ${r.text.slice(0, 120)}`, objects: { claimStatus: r.json?.claim_status ?? null, project: r.json?.project?.id ?? null } };
      },
    },
  }),
  defineSignupTask({
    id: "inkbox-signup",
    name: "Inkbox (agent signup)",
    url: "https://inkbox.ai",
    docsHint: "https://inkbox.ai/docs/get-started/agent-signup",
    apiHost: "inkbox.ai",
    network: ["inkbox.ai", "inkboxmail.com"],
    credentialEnvName: "INKBOX_API_KEY",
    keyPattern: /^ApiKey_[A-Za-z0-9-]{20,}\.[A-Za-z0-9_-]{8,}$/,
    verify: {
      describe: "GET https://inkbox.ai/api/v1/agent-signup/status with X-API-Key",
      call: async (key) => {
        const r = await req("https://inkbox.ai/api/v1/agent-signup/status", { headers: { "x-api-key": key } });
        return { ok: r.status === 200 && Boolean(r.json?.claim_status), status: r.status, detail: r.jsonError ? r.jsonError : r.status === 200 ? `claim_status ${r.json?.claim_status}, human_state ${r.json?.human_state}, max_sends_per_day ${r.json?.restrictions?.max_sends_per_day ?? "?"}` : `HTTP ${r.status}: ${r.text.slice(0, 120)}`, objects: { claimStatus: r.json?.claim_status ?? null } };
      },
    },
  }),
  defineSignupTask({
    id: "monday-signup",
    name: "monday.com",
    url: "https://monday.com",
    docsHint: "https://monday.com/agents-signup",
    apiHost: "api.monday.com",
    network: ["monday.com", "developer.monday.com", "api.monday.com", "signup-logic.monday.com", "auth.monday.com", "mcp.monday.com", "support.monday.com"],
    credentialEnvName: "MONDAY_API_TOKEN",
    keyPattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    verify: {
      describe: "POST https://api.monday.com/v2 { me { id name } } with Authorization: <token>",
      call: async (key) => {
        const r = await req("https://api.monday.com/v2", { method: "POST", headers: { "content-type": "application/json", authorization: key }, body: JSON.stringify({ query: "{ me { id name email account { slug } } }" }) });
        const me = r.json?.data?.me;
        return { ok: r.status === 200 && Boolean(me?.id), status: r.status, detail: me ? `me.id ${me.id}, account ${me.account?.slug}` : `HTTP ${r.status}: ${r.text.slice(0, 120)}`, objects: me ? { userId: me.id, slug: me.account?.slug } : null };
      },
    },
  }),
  defineSignupTask({
    id: "telnyx-signup",
    name: "Telnyx",
    url: "https://telnyx.com",
    docsHint: "https://telnyx.com/agent-signup.md",
    apiHost: "api.telnyx.com",
    network: ["telnyx.com", "developers.telnyx.com", "api.telnyx.com", "agent-inbox.telnyx.com", "portal.telnyx.com"],
    credentialEnvName: "TELNYX_API_KEY",
    keyPattern: /^KEY[A-Za-z0-9_-]{10,}$/,
    verify: {
      describe: "GET https://api.telnyx.com/v2/balance with Authorization: Bearer <key>",
      call: async (key) => {
        const r = await req("https://api.telnyx.com/v2/balance", { headers: { authorization: `Bearer ${key}` } });
        return { ok: r.status === 200 && Boolean(r.json?.data), status: r.status, detail: r.jsonError ? r.jsonError : r.status === 200 ? `balance ${r.json?.data?.balance ?? "?"} ${r.json?.data?.currency ?? ""}` : `HTTP ${r.status}: ${r.text.slice(0, 120)}` };
      },
    },
  }),
  defineSignupTask({
    id: "whisper-signup",
    name: "Whisper Security",
    url: "https://www.whisper.security",
    docsHint: "https://www.whisper.security/docs/ai/agent-signup",
    apiHost: "graph.whisper.security",
    network: ["whisper.security", "www.whisper.security", "console.whisper.security", "graph.whisper.security", "mcp.whisper.security"],
    credentialEnvName: "WHISPER_API_KEY",
    keyPattern: /^whisper-[A-Za-z0-9_-]{8,}$/,
    verify: {
      describe: "POST https://graph.whisper.security/api/query CALL whisper.quota() with X-API-Key; isAnonymous must be false",
      call: async (key) => {
        const r = await req("https://graph.whisper.security/api/query", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, body: JSON.stringify({ query: "CALL whisper.quota()" }) });
        // whisper.quota() yields columns key,value: one object row per key. isAnonymous is a ROW, not a column.
        // (docs/whisper-graph/procedures.md). Two earlier evaluator versions got this wrong; the run pays for it.
        const rows = Array.isArray(r.json?.rows) ? r.json.rows : [];
        const hit = rows.find((row) => row && (row.key === "isAnonymous" || "isAnonymous" in row));
        const anon = hit ? (hit.key === "isAnonymous" ? hit.value : hit.isAnonymous) : undefined;
        return { ok: r.status === 200 && anon === false, status: r.status, detail: r.jsonError ? r.jsonError : r.status === 200 ? `isAnonymous=${JSON.stringify(anon)} (${rows.length} rows: ${rows.map((x) => x.key ?? Object.keys(x)[0]).slice(0, 6).join(",")})` : `HTTP ${r.status}: ${r.text.slice(0, 120)}` };
      },
    },
  }),
  defineSignupTask({
    id: "aisend-signup",
    name: "AISend",
    url: "https://aisend.app",
    docsHint: "https://aisend.app/agents",
    apiHost: "api.aisend.app",
    network: ["aisend.app", "api.aisend.app", "agent.aisend.app"],
    credentialEnvName: "AISEND_API_KEY",
    keyPattern: /^re_[A-Za-z0-9_-]{6,}$/,
    verify: {
      describe: "GET https://api.aisend.app/api/v1/api-keys with Authorization: Bearer <key>",
      call: async (key) => {
        const r = await req("https://api.aisend.app/api/v1/api-keys", { headers: { authorization: `Bearer ${key}` } });
        return { ok: r.status === 200, status: r.status, detail: r.status === 200 ? `api-keys list returned 200 (${r.text.length} bytes)` : `HTTP ${r.status}: ${r.text.slice(0, 120)}` };
      },
    },
  }),
  defineSignupTask({
    id: "moltbook-signup",
    name: "Moltbook",
    url: "https://www.moltbook.com",
    docsHint: "https://www.moltbook.com/skill.md",
    apiHost: "www.moltbook.com",
    network: ["moltbook.com", "www.moltbook.com"],
    credentialEnvName: "MOLTBOOK_API_KEY",
    keyPattern: /^moltbook_[A-Za-z0-9_-]{6,}$/,
    verify: {
      describe: "GET https://www.moltbook.com/api/v1/agents/me with Authorization: Bearer <key>",
      call: async (key) => {
        const r = await req("https://www.moltbook.com/api/v1/agents/me", { headers: { authorization: `Bearer ${key}` } });
        const status = await req("https://www.moltbook.com/api/v1/agents/status", { headers: { authorization: `Bearer ${key}` } });
        return { ok: r.status === 200, status: r.status, detail: r.status === 200 ? `profile 200; claim status ${status.json?.status ?? status.jsonError ?? "?"}` : `HTTP ${r.status}: ${r.text.slice(0, 120)}`, objects: { claimStatus: status.json?.status ?? null } };
      },
    },
  }),
  defineSignupTask({
    id: "edge-signup",
    name: "Edge Network",
    url: "https://edge.network",
    docsHint: "https://edge.network/docs/agent/self-signup",
    apiHost: "edge.network",
    network: ["edge.network", "control.edge.network"],
    credentialEnvName: "EDGE_AGENT_CODE",
    keyPattern: /^ea_live_[a-f0-9]{32,}$/,
    verify: {
      describe: "GET https://edge.network/agent with Authorization: Bearer <code>",
      call: async (key) => {
        const r = await req("https://edge.network/agent", { headers: { authorization: `Bearer ${key}` } });
        return { ok: r.status === 200 && Boolean(r.json?.account || r.json?.budget), status: r.status, detail: r.jsonError ? r.jsonError : r.status === 200 ? `discovery 200; tier ${r.json?.account?.tier ?? r.json?.budget?.tier ?? "?"}` : `HTTP ${r.status}: ${r.text.slice(0, 120)}` };
      },
    },
  }),
];
