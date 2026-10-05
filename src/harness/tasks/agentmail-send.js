// ONE task against ONE product. AgentMail documents an agent self-signup path (POST /agent/sign-up → OTP to a human
// email → POST /agent/verify → API key). The persona's inbox is the "human email", so the loop can close without a
// person. Deterministic success: a message tagged with the run id reaches the persona inbox from a new agentmail
// address. Signup mode only; no credential is ever injected for this task.

export const PERSONA_INBOX = "ari-vale-agent-ready@agentmail.to";

export const task = {
  id: "agentmail-send",
  url: "https://agentmail.to",
  apiHost: "api.agentmail.to",
  credentialEnvName: "AGENTMAIL_API_KEY",
  text: `Sign up for AgentMail, create an inbox, and send an email from it to ${PERSONA_INBOX} with the subject "agent-ready <runId>".`,
  credentials: [],
  network: ["agentmail.to", "docs.agentmail.to", "api.agentmail.to", "console.agentmail.to"],
  instructions: {
    always: [
      "Work only inside the current directory. Do not touch other directories.",
      "Write PLAN.md first: which interface you will use, where you learned how to sign up and authenticate (URL), and the exact steps. Then act.",
      "Use the exact subject \"agent-ready <runId>\" so the run can be audited.",
      "Do not decide or state whether you succeeded. When you have done what you can, stop.",
    ],
    withCredential: [],
    signup: [
      "You have no API key. Obtain one yourself using only what the product's own pages and your inbox give you. If the product offers a signup path meant for agents, prefer it; your persona email is the human contact address.",
      "When you have a key, write it to CREDENTIAL.env as a single line AGENTMAIL_API_KEY=<key> and nowhere else, then continue with the task using it.",
      "If you reach a step no agent can pass without a human (CAPTCHA, phone verification, identity documents, payment details), write NEEDS_HUMAN.md stating the exact step, the URL, and what it asked for, then stop. Do not try to bypass it.",
    ],
    withoutCredential: ["No credential is available and signup is not attempted in this mode. Read the documentation, write PLAN.md and request.sh with $AGENTMAIL_API_KEY as a placeholder, write NEEDS_CREDENTIAL.md, then stop."],
  },
  criteria: {
    local: ["PLAN.md exists and names an interface and an authentication source URL", "signup mode: CREDENTIAL.env holds a key that authenticates (GET /v0/inboxes 200), or NEEDS_HUMAN.md names the blocking step and URL"],
    live: [`a message with subject containing the run id arrived in ${PERSONA_INBOX} from an agentmail.to address other than the persona's`],
  },
};

async function api(key, path) {
  const res = await fetch(`https://api.agentmail.to/v0${path}`, { signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${key}` } });
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

// Deterministic. Local checks read the scratch directory. The live check reads the persona inbox: through the
// AgentMail API when the harness has AGENTMAIL_API_KEY, otherwise through the relayed message files in work/inbox/.
export async function evaluate({ runId, files, credentials, mode, inboxFiles = [], harnessMailKey = null }) {
  const checks = [];
  const plan = files.read("PLAN.md");
  const planUrl = plan ? (plan.match(/https?:\/\/[^\s)>\]]+/) || [null])[0] : null;
  checks.push({ id: "plan_written", tier: "local", pass: Boolean(plan && /\bAPI\b|\bMCP\b|\bCLI\b/i.test(plan) && planUrl), detail: plan ? `PLAN.md ${plan.length} chars; interface ${(plan.match(/\bMCP\b|\bCLI\b|\bAPI\b/i) || ["not named"])[0]}; auth source ${planUrl || "no URL"}` : "no PLAN.md", evidence: { file: "PLAN.md" } });

  let authenticated = null;
  if (mode === "signup") {
    const cred = files.readRaw("CREDENTIAL.env");
    const found = cred ? (cred.match(/AGENTMAIL_API_KEY=([^\s]+)/) || [])[1] : null;
    const human = files.read("NEEDS_HUMAN.md");
    if (found) {
      const probe = await api(found, "/inboxes?limit=1");
      authenticated = probe.status === 200;
      checks.push({ id: "credential_acquired", tier: "local", pass: authenticated, detail: authenticated ? `agent obtained a key that authenticates (GET /v0/inboxes 200, ${probe.body?.count ?? "?"} inbox(es))` : `agent wrote a key but AgentMail returned ${probe.status}`, evidence: { file: "CREDENTIAL.env", request: "GET /v0/inboxes?limit=1", status: probe.status, jsonError: probe.jsonError } });
    } else {
      checks.push({ id: "credential_acquired", tier: "local", pass: false, status: human ? "human_required" : "not_acquired", detail: human ? `stopped at a human-only step: ${human.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 140) || "see NEEDS_HUMAN.md"}` : "no key obtained and no NEEDS_HUMAN.md", evidence: { file: human ? "NEEDS_HUMAN.md" : null } });
    }
  } else {
    checks.push({ id: "credential_need_documented", tier: "local", pass: Boolean(files.read("NEEDS_CREDENTIAL.md")), detail: files.read("NEEDS_CREDENTIAL.md") ? "NEEDS_CREDENTIAL.md written" : "no NEEDS_CREDENTIAL.md", evidence: { file: "NEEDS_CREDENTIAL.md" } });
    checks.push({ id: "message_received", tier: "live", pass: null, status: "credential_required", detail: "signup not attempted in this mode", evidence: null });
    return { method: "deterministic", checkedAt: new Date().toISOString(), success: false, stoppedAt: "credential_required", checks, authenticated: null, objects: null, keySource: null };
  }

  // Live: did the tagged message reach the persona inbox?
  const tag = `agent-ready ${runId}`;
  let hit = null;
  let source;
  let listError = null;
  if (harnessMailKey) {
    source = "agentmail api";
    const list = await api(harnessMailKey, `/inboxes/${encodeURIComponent(PERSONA_INBOX)}/messages?limit=50`);
    listError = list.jsonError;
    hit = (list.body?.messages || []).find((m) => (m.subject || "").includes(tag) && !String(m.from || "").includes(PERSONA_INBOX)) || null;
  } else {
    source = `relayed files in work/inbox (${inboxFiles.length})`;
    hit = inboxFiles.find((m) => (m.subject || "").includes(tag) && !String(m.from || "").includes(PERSONA_INBOX)) || null;
  }
  checks.push({ id: "message_received", tier: "live", pass: Boolean(hit), detail: hit ? `message "${hit.subject}" from ${hit.from} at ${hit.timestamp}` : `no message with subject containing "${tag}" in ${PERSONA_INBOX} (${source})${listError ? `; ${listError}` : ""}`, evidence: { source, message_id: hit?.message_id ?? null, jsonError: listError } });

  return { method: "deterministic", checkedAt: new Date().toISOString(), success: checks.filter((c) => c.tier === "live").every((c) => c.pass === true), stoppedAt: null, checks, authenticated, objects: hit ? { message_id: hit.message_id, from: hit.from } : null, keySource: "agent" };
}
