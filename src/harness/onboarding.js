import { verdict } from "../interface/evaluate.js";

// Onboarding rules over one executed run. They read what the product sent back to the agent (tool results: the signup
// response, 402/403 bodies, status bodies, docs the agent fetched), what the deterministic evaluator recorded, and the
// two RESULT.md lines the signup task asks for. Nothing here is asked of a model. Every rule returns unknown when the
// run never reached the surface it needs; a signup that was not attempted says nothing about the product.
// basedOn ids: event:<seq> (a tool result in execution.json), file:<name>, evaluation.checks.<id>, evaluation.observed.<field>.

export const ONBOARDING_RULES = ["email_requirement", "bootstrap_without_human", "expiry_stated_in_response", "claim_mechanism", "gate_machine_readable", "status_endpoint", "bot_check_kind", "owner_bind_later", "payment_entry", "rate_limits_documented"];

const REDACTED_RE = /<redacted>|…redacted|\.\.\.redacted/;
const CREDENTIAL_KEY_RE = /\b(api_?key|apiKey|agent_key|secret_key|access_?token|apiToken|tokenId|access_code|accessCode|claim_token|assertion|database_url)\b/i;
// A status code the product returned, as agents print it: "HTTP 403", "balance_http=403", "403\n{", "status: 403". Prose like "returns 403" does not match.
const marker = (codes) => new RegExp(`(?:HTTP\\/?[\\d.]*\\s+|_http=|status(?:_code)?\\W{0,3}|^\\s*)(${codes})\\b`, "im");
const CREATED_RE = marker("20[01]");
const EXPIRY_RE = /\b(expires_at|expiresAt|expires_in|expiresIn|claimExpiresAt|claim\.expiresAt|auto_delete_after_days|ttl|ttl_seconds|valid_until|validUntil)\b["']?\s*[:=]?\s*["']?(null|\d[\dT:.\-Z]*)/i;
const EXPIRY_PROSE_RE = /auto-?delete|expires (?:in|after|within)|deleted after/i;
const CLAIM_URL_RE = /\b(claim_url|claimUrl|claim\.url|hasClaimUrl\s+true|claim_token|setup_url|checkout_url)\b|https?:\/\/\S*(?:\/claim|onboard_sandbox|claim-preview|checkout)\S*/i;
const STATE_RE = /["']?(claim_status|auth_type|human_state|agent_status)["']?\s*[:=]|["']?status["']?\s*[:=]\s*["']?(pending_claim|provisional|unclaimed|claimed|verified|restricted|guest)\b/i;
const LIMITS_RE = /["']?(limits|remaining|restrictions|auto_delete_after_days|expires_at|budget|quota)["']?\s*[:=]/i;
const ACTION_RE = /["']?(action|gate|next_step|requires_claim)["']?\s*[:=]/i;
const TARGET_RE = /["']?(url|poll|claim_url|status_url|checkout_url|setup_url|retry_after)["']?\s*[:=]/i;
const GATE_CODE_RE = /(requires_claim|claim_required|payment_required|budget_exceeded|scope_denied|spend_cap_exceeded|capability_requires_claim|upgrade_required|insufficient_(?:funds|credits))/i;
const DOMAIN_REFUSED_RE = /domain (?:is )?(?:forbidden|not allowed|blocked|rejected)|blocklist|disposable/i;
const POW_RE = /proof.of.work|\bPoW\b|hashcash|["']algorithm["']\s*:\s*["']SHA-256|checkpoint|challengeToken|difficulty|leading zero bits|["']salt["']\s*:/i;
const REASONING_RE = /challenge_type|agent.?captcha|reverse captcha|verificationToken|["']problem["']\s*:/i;
const OWNER_RE = /owner_url|["']?owner_email["']?\s*[:=]|\/owner\b|nominat(?:e|ed_email)|add (?:an )?owner|owner email (?:is )?optional|email (?:is )?optional/i;
const LIMIT_RE = /ratelimit-(?:limit|remaining|reset)\s*:|x-ratelimit-[a-z]+\s*:|rate.?limits?\b.{0,80}\d|\d+ (?:(?:requests?|calls|signups?) )?per (?:minute|hour|day|second|ip)\b/i;
const RETRY_RE = /retry-after\s*:|["']?retry_after["']?\s*[:=]/i;

function quote(text, re, width = 200) {
  const m = re.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - width / 3);
  return text.slice(start, start + width).replace(/\s+/g, " ").trim();
}

function rule(name, value, v, reason, basedOn, evidence = []) {
  return { value, ...verdict(v, reason, basedOn, `onboarding.${name}`), evidence: evidence.filter((e) => e && e.quote) };
}

const ev = (seq, text, re) => ({ source: `event:${seq}`, quote: quote(text, re) });
const fileEv = (name, text, re) => ({ source: `file:${name}`, quote: quote(text, re) });

function results(execution) {
  return (execution.events || []).filter((e) => e.kind === "tool_result" && typeof e.text === "string");
}

// The response that carried the credential: the first tool result where a redacted value sits beside a 2xx, else the
// first 2xx body naming a credential field. Both miss a CLI that prints nothing machine-shaped (Mem0) or a truncated result (Edge).
export function signupResponse(execution) {
  const rs = results(execution);
  return rs.find((e) => REDACTED_RE.test(e.text) && CREATED_RE.test(e.text)) || rs.find((e) => CREDENTIAL_KEY_RE.test(e.text) && CREATED_RE.test(e.text)) || null;
}

function gateBodies(execution) {
  const out = [];
  for (const e of results(execution)) {
    const m = marker("402|403").exec(e.text);
    // curl -w prints the status after the body, so the envelope can sit well above the marker.
    if (m) out.push({ seq: e.seq, code: m[1], text: e.text.slice(Math.max(0, m.index - 1500), m.index + 1500) });
  }
  return out;
}

export function evaluateOnboarding({ execution, evaluation, resultMd = null, needsHumanMd = null }) {
  const attempted = execution.mode === "signup";
  const check = (id) => evaluation?.checks?.find((c) => c.id === id);
  const issued = check("credential_acquired")?.pass === true;
  const works = check("credential_works")?.pass === true;
  const rs = results(execution);
  const all = rs.map((e) => e.text).join("\n");
  const signup = signupResponse(execution);
  const gates = gateBodies(execution);
  const stateBodies = rs.filter((e) => e !== signup && STATE_RE.test(e.text));
  const bodies = `${signup?.text || ""}\n${gates.map((g) => g.text).join("\n")}\n${stateBodies.map((e) => e.text).join("\n")}`;
  // The agent's notes: RESULT.md, NEEDS_HUMAN.md, and the two lines the evaluator lifted from RESULT.md.
  const md = `${resultMd || ""}\n${needsHumanMd || ""}\n${evaluation?.observed?.emailRequirement || ""}\n${evaluation?.observed?.humanGate || ""}`;
  // What a human still has to do, in the agent's own words: the RESULT.md line the task asks for, plus NEEDS_HUMAN.md.
  const humanGate = `${evaluation?.observed?.humanGate || (md.match(/^Human gate:\s*(.+)$/im) || [])[1] || ""}\n${needsHumanMd || ""}`;
  const notAttempted = (name, value = null) => rule(name, value, "unknown", `signup not attempted in mode ${execution.mode}; nothing observed about the product's onboarding`, []);
  const out = {};

  // email_requirement: the RESULT.md line the task asks for, plus a domain refusal seen in a 403/422 body.
  {
    const line = evaluation?.observed?.emailRequirement || (md.match(/^Email requirement:\s*(.+)$/im) || [])[1] || null;
    const token = line ? (line.match(/^\s*(none|product[-_ ]issued|agent[-_ ]email|human[-_ ]email)\b/i) || [])[1]?.toLowerCase().replace(/[-_ ]/g, "_") : null;
    const value = { none: "none", product_issued: "product_issued", agent_email: "agent_email_accepted", human_email: "human_email_required" }[token] || null;
    const blocked = rs.find((e) => marker("403|422").test(e.text) && DOMAIN_REFUSED_RE.test(e.text));
    const basedOn = [line ? "evaluation.observed.emailRequirement" : null, blocked ? `event:${blocked.seq}` : null];
    const evidence = [line ? { source: "file:RESULT.md", quote: line.slice(0, 200) } : null, blocked ? ev(blocked.seq, blocked.text, DOMAIN_REFUSED_RE) : null];
    if (!attempted) out.email_requirement = notAttempted("email_requirement");
    else if (!value && !blocked) out.email_requirement = rule("email_requirement", null, "unknown", "RESULT.md has no 'Email requirement:' line and no email refusal was returned", []);
    else if (blocked) out.email_requirement = rule("email_requirement", value || "human_email_required", "no", "the product refused the agent's email domain; a human's address on another domain is required", basedOn, evidence);
    else if (value === "human_email_required") out.email_requirement = rule("email_requirement", value, issued ? "partial" : "no", issued ? "a human's email is required by the form, but an agent-readable inbox was accepted and the credential was issued" : "a human's email is required and no credential was issued", basedOn, evidence);
    else out.email_requirement = rule("email_requirement", value, "yes", value === "agent_email_accepted" ? "the agent's own address was accepted as the account holder; verification checks inbox access, not humanity" : value === "product_issued" ? "the product issued the agent its own identity; no outside address needed" : "no email was involved in issuing the credential", basedOn, evidence);
    out.email_requirement.domainBlocklistDetected = Boolean(blocked);
  }

  // bootstrap_without_human: the evaluator's own live call decides; the mailbox count says whether an inbox step sat in between.
  {
    const acquired = check("credential_acquired");
    const mail = execution.mail?.delivered?.length ?? 0;
    const basedOn = ["evaluation.checks.credential_acquired", "evaluation.checks.credential_works", mail ? "execution.mail.delivered" : null];
    if (!attempted) out.bootstrap_without_human = notAttempted("bootstrap_without_human");
    else if (works && mail === 0) out.bootstrap_without_human = rule("bootstrap_without_human", true, "yes", `credential issued and verified by the evaluator's live call (${check("credential_works").detail}); no email arrived`, basedOn);
    else if (works) out.bootstrap_without_human = rule("bootstrap_without_human", true, "partial", `credential verified, but ${mail} message(s) had to be read from the inbox first (OTP or magic link); an inbox the agent owns is not a human, but it is a step outside the API`, basedOn);
    else if (acquired?.status === "human_required" || execution.signals?.captcha) out.bootstrap_without_human = rule("bootstrap_without_human", false, "no", execution.signals?.captcha ? `a CAPTCHA for humans stopped the agent (${execution.signals.captcha})` : `the agent stopped at a human-only step: ${acquired?.detail || "see NEEDS_HUMAN.md"}`, [...basedOn, execution.signals?.captcha ? "execution.signals.captcha" : "file:NEEDS_HUMAN.md"]);
    else if (issued) out.bootstrap_without_human = rule("bootstrap_without_human", null, "partial", `a credential was issued but the evaluator's live call did not accept it (${check("credential_works")?.detail || "no detail"})`, basedOn);
    else out.bootstrap_without_human = rule("bootstrap_without_human", null, "unknown", `no credential and no human step recorded (${acquired?.detail || execution.stoppedBecause}); the run says nothing about the product's bootstrap`, basedOn);
  }

  // expiry_stated_in_response: a TTL field in the body that carried the credential, not in docs.
  {
    const inResponse = signup ? EXPIRY_RE.exec(signup.text) : null;
    const elsewhere = rs.find((e) => e !== signup && (EXPIRY_RE.test(e.text) || EXPIRY_PROSE_RE.test(e.text)));
    if (!attempted) out.expiry_stated_in_response = notAttempted("expiry_stated_in_response");
    else if (!signup) out.expiry_stated_in_response = rule("expiry_stated_in_response", null, "unknown", issued ? "a credential was issued but no machine-shaped signup response appears in the trace (CLI output or a truncated tool result)" : "no signup response was observed", []);
    else if (inResponse) out.expiry_stated_in_response = rule("expiry_stated_in_response", `${inResponse[1]}=${inResponse[2]}`, "yes", `the signup response states ${inResponse[1]} ${inResponse[2] === "null" ? "(null: no expiry)" : inResponse[2]}`, [`event:${signup.seq}`], [ev(signup.seq, signup.text, EXPIRY_RE)]);
    else if (elsewhere) out.expiry_stated_in_response = rule("expiry_stated_in_response", null, "partial", "no expiry in the signup response; an expiry or auto-delete is stated in another response or page the agent read", [`event:${signup.seq}`, `event:${elsewhere.seq}`], [ev(elsewhere.seq, elsewhere.text, EXPIRY_RE.test(elsewhere.text) ? EXPIRY_RE : EXPIRY_PROSE_RE)]);
    else out.expiry_stated_in_response = rule("expiry_stated_in_response", null, "no", "the signup response carries no expiry or TTL field and nothing the agent read states one", [`event:${signup.seq}`]);
  }

  // claim_mechanism: how a human takes over, read from product bodies first and the agent's human-gate note second.
  {
    let mech = "none";
    if (/checkout\.stripe\.com|checkout_url|setup_url|payment_required|["']gate["']\s*[:=]\s*["']payment|paying claims/i.test(bodies)) mech = "payment";
    else if (/\btweet\b/i.test(bodies) || /\btweet\b/i.test(humanGate) || (/verification_code/i.test(bodies) && /\btweet\b/i.test(all))) mech = "tweet";
    else if (signup && CLAIM_URL_RE.test(signup.text)) mech = "link";
    else if (/device_code|user_code|verification_uri/i.test(bodies)) mech = "device_code";
    else if (/\b(otp|one-time code|6-digit|verification code|claim code|emailed code)\b/i.test(humanGate)) mech = "email_code";
    else if (/claim (?:url|link)|claim_url/i.test(humanGate)) mech = "link";
    const urlIn = signup && CLAIM_URL_RE.test(signup.text) ? signup : gates.find((g) => /["']?(url|poll|claim_url|checkout_url|setup_url)["']?\s*[:=]\s*["']?https?:/i.test(g.text)) || stateBodies.find((e) => CLAIM_URL_RE.test(e.text)) || null;
    const basedOn = [signup ? `event:${signup.seq}` : null, urlIn && urlIn !== signup ? `event:${urlIn.seq}` : null, "file:RESULT.md"];
    if (!attempted) out.claim_mechanism = notAttempted("claim_mechanism");
    else if (!signup && !issued) out.claim_mechanism = rule("claim_mechanism", null, "unknown", "no signup response was observed; the claim step was never reached", []);
    else if (mech === "none") out.claim_mechanism = rule("claim_mechanism", "none", "partial", "no claim mechanism appears in the signup response, gate or status bodies, or the agent's human-gate note; how a human takes ownership is not machine-stated", basedOn);
    else out.claim_mechanism = rule("claim_mechanism", mech, urlIn ? "yes" : "partial", urlIn ? `claim by ${mech.replace(/_/g, " ")}; the claim URL is in the ${urlIn === signup ? "signup response" : "a later response body"}` : `claim by ${mech.replace(/_/g, " ")}; no claim URL was handed to the agent in a response body`, basedOn, [urlIn ? ev(urlIn.seq, urlIn.text, CLAIM_URL_RE) : fileEv("RESULT.md", humanGate, mech === "email_code" ? /otp|code/i : new RegExp(mech.replace(/_/g, " "), "i"))]);
    out.claim_mechanism.claimUrlInResponse = Boolean(urlIn);
  }

  // gate_machine_readable: a 402/403 the product actually returned, and whether its body tells the agent what to do next.
  {
    const full = gates.find((g) => ACTION_RE.test(g.text) && TARGET_RE.test(g.text));
    const coded = gates.find((g) => ACTION_RE.test(g.text) || GATE_CODE_RE.test(g.text));
    const documented = rs.find((e) => /\b40[23]\b/.test(e.text) && (ACTION_RE.test(e.text) || GATE_CODE_RE.test(e.text)));
    if (!attempted) out.gate_machine_readable = notAttempted("gate_machine_readable");
    else if (full) out.gate_machine_readable = rule("gate_machine_readable", true, "yes", `a ${full.code} body carries an action field and a url/poll/retry_after the agent can act on`, [`event:${full.seq}`], [ev(full.seq, full.text, ACTION_RE)]);
    else if (coded) out.gate_machine_readable = rule("gate_machine_readable", "code_only", "partial", `a ${coded.code} body names the gate in a machine code but gives no url, poll or retry_after`, [`event:${coded.seq}`], [ev(coded.seq, coded.text, ACTION_RE.test(coded.text) ? ACTION_RE : GATE_CODE_RE)]);
    else if (gates.length) out.gate_machine_readable = rule("gate_machine_readable", false, "no", `${gates.length} 402/403 response(s) observed; the body is prose or HTML with no gate, action or url field`, gates.map((g) => `event:${g.seq}`), [{ source: `event:${gates[0].seq}`, quote: gates[0].text.replace(/\s+/g, " ").slice(0, 200) }]);
    else if (documented) out.gate_machine_readable = rule("gate_machine_readable", "documented", "partial", "no 402/403 was returned in the run; the docs the agent read describe a machine-coded gate body", [`event:${documented.seq}`], [ev(documented.seq, documented.text, GATE_CODE_RE.test(documented.text) ? GATE_CODE_RE : ACTION_RE)]);
    else out.gate_machine_readable = rule("gate_machine_readable", null, "unknown", "no 402 or 403 was returned and none is described in what the agent read; the gate was not reached", []);
  }

  // status_endpoint: the agent was told where its account state lives, or read it.
  {
    const withLimits = stateBodies.find((e) => LIMITS_RE.test(e.text));
    const statusUrl = signup && /["']?status_url["']?\s*[:=]/i.test(signup.text);
    if (!attempted) out.status_endpoint = notAttempted("status_endpoint");
    else if (!signup && !stateBodies.length) out.status_endpoint = rule("status_endpoint", null, "unknown", "no signup response and no account-state body observed", []);
    else if (withLimits) out.status_endpoint = rule("status_endpoint", true, "yes", "a response carries the account state together with limits, remaining or expiry", [`event:${withLimits.seq}`], [ev(withLimits.seq, withLimits.text, STATE_RE)]);
    else if (statusUrl) out.status_endpoint = rule("status_endpoint", true, "yes", "the signup response names a status URL for the account", [`event:${signup.seq}`], [ev(signup.seq, signup.text, /status_url/i)]);
    else if (stateBodies.length) out.status_endpoint = rule("status_endpoint", "state_only", "partial", "a response carries the account state but no limits, remaining or expiry", [`event:${stateBodies[0].seq}`], [ev(stateBodies[0].seq, stateBodies[0].text, STATE_RE)]);
    else out.status_endpoint = rule("status_endpoint", false, "no", "the signup response names no status URL and no account-state body was returned during the run", [`event:${signup.seq}`]);
  }

  // bot_check_kind: what stood between the agent and the credential. A CAPTCHA for humans is the one kind an agent cannot pass by design.
  {
    const label = { proof_of_work: "proof-of-work", reasoning_challenge: "reasoning", rate_limit: "rate-limit" };
    const captcha = execution.signals?.captcha || null;
    const pow = rs.find((e) => POW_RE.test(e.text));
    const reasoning = rs.find((e) => REASONING_RE.test(e.text));
    const limited = rs.find((e) => marker("429").test(e.text));
    const reported = POW_RE.test(md) ? "proof_of_work" : REASONING_RE.test(md) || /reasoning (?:problem|challenge)/i.test(md) ? "reasoning_challenge" : null;
    const hit = reasoning || pow || limited;
    const kind = captcha ? "captcha" : reasoning ? "reasoning_challenge" : pow ? "proof_of_work" : limited ? "rate_limit" : reported ? reported : signup && issued ? "none" : null;
    const basedOn = [captcha ? "execution.signals.captcha" : hit ? `event:${hit.seq}` : reported ? "file:RESULT.md" : `event:${signup?.seq}`];
    if (!attempted) out.bot_check_kind = notAttempted("bot_check_kind");
    else if (kind === "captcha") out.bot_check_kind = rule("bot_check_kind", kind, "no", `a CAPTCHA built for humans gates signup (${captcha}); no agent design passes it`, basedOn);
    else if (kind === null) out.bot_check_kind = rule("bot_check_kind", null, "unknown", issued ? "credential issued, but no signup response is in the trace to show what challenge, if any, preceded it" : "no challenge observed and no credential issued; the check, if any, was not reached", []);
    else if (kind === "none") out.bot_check_kind = rule("bot_check_kind", kind, "yes", "credential issued with no challenge of any kind in the responses", basedOn);
    else if (!hit && reported) out.bot_check_kind = rule("bot_check_kind", kind, "partial", `a ${label[kind]} challenge is reported by the agent in RESULT.md; the challenge response itself is not in the trace`, basedOn, [fileEv("RESULT.md", md, kind === "proof_of_work" ? POW_RE : REASONING_RE)]);
    else out.bot_check_kind = rule("bot_check_kind", kind, issued ? "yes" : "partial", issued ? `a ${label[kind]} challenge meant for machines; the agent solved it and the credential was issued` : `a ${label[kind]} challenge was met; no credential followed (${check("credential_acquired")?.detail || execution.stoppedBecause})`, basedOn, [ev(hit.seq, hit.text, reasoning ? REASONING_RE : pow ? POW_RE : marker("429"))]);
  }

  // owner_bind_later: an owner can be attached after bootstrap by the agent, without the human acting first.
  {
    const inSignup = signup && /owner_url|\/owner\b|nominated_email/i.test(signup.text);
    const inBodies = stateBodies.find((e) => /owner_url|\/owner\b|nominated_email|bound_at/i.test(e.text));
    const inText = rs.find((e) => OWNER_RE.test(e.text)) || (OWNER_RE.test(md) ? { seq: null, text: md } : null);
    if (!attempted) out.owner_bind_later = notAttempted("owner_bind_later");
    else if (!signup && !issued) out.owner_bind_later = rule("owner_bind_later", null, "unknown", "no credential was issued; nothing to bind an owner to", []);
    else if (inSignup || inBodies) out.owner_bind_later = rule("owner_bind_later", true, "yes", "a response names an owner endpoint or an owner field the agent can set after signup", [`event:${(inSignup ? signup : inBodies).seq}`], [ev((inSignup ? signup : inBodies).seq, (inSignup ? signup : inBodies).text, /owner_url|\/owner\b|nominated_email|bound_at/i)]);
    else if (inText) out.owner_bind_later = rule("owner_bind_later", true, "partial", "text the agent read says an owner or email can be attached after signup; no endpoint for it was in a response body", [inText.seq ? `event:${inText.seq}` : "file:RESULT.md"], [inText.seq ? ev(inText.seq, inText.text, OWNER_RE) : fileEv("RESULT.md", md, OWNER_RE)]);
    else if (out.email_requirement.value === "human_email_required") out.owner_bind_later = rule("owner_bind_later", false, "no", "the owner's email is fixed at signup; nothing read offers a later nomination", [signup ? `event:${signup.seq}` : "evaluation.observed.emailRequirement"]);
    else out.owner_bind_later = rule("owner_bind_later", null, "unknown", "nothing the agent read mentions attaching an owner after signup", []);
  }

  // payment_entry: where money would enter, as far as the run got.
  {
    const x402 = rs.find((e) => marker("402").test(e.text) && /x-payment|x402|payment-required.{0,80}(usdc|wallet|erc|eip)/i.test(e.text));
    // Only what the product returned to this agent: a runbook example of a mandate is not an offered mandate.
    const returned = `${signup?.text || ""}\n${gates.map((g) => g.text).join("\n")}`;
    const mandate = /["']?spend_mandate["']?\s*[:=]\s*\{[^}]*(setup_url|["']status["']\s*:\s*["'](pending|active))/i.test(returned);
    const checkout = /checkout\.stripe\.com|checkout_url|setup_url|["']gate["']\s*[:=]\s*["']payment|payment_required|https?:\/\/\S*checkout\S*/i.test(bodies);
    const value = x402 ? "per_request_402" : mandate ? "pre_authorized_mandate" : checkout ? "human_checkout_url" : "none_reached";
    const srcRe = value === "pre_authorized_mandate" ? /spend_mandate["']?\s*[:=]\s*\{/i : /checkout|setup_url|payment_required|["']gate["']\s*[:=]\s*["']payment/i;
    const src = x402 || (value === "none_reached" ? null : [...gates, signup, ...stateBodies].filter(Boolean).find((e) => srcRe.test(e.text)));
    const basedOn = [src ? `event:${src.seq}` : null];
    if (!attempted) out.payment_entry = notAttempted("payment_entry", "none_reached");
    else if (value === "per_request_402") out.payment_entry = rule("payment_entry", value, "yes", "a 402 with payment headers: the agent pays per request, no account or human", basedOn, [ev(src.seq, src.text, /x-payment|x402/i)]);
    else if (value === "pre_authorized_mandate") out.payment_entry = rule("payment_entry", value, "yes", "the response offers a spend mandate: one human authorization, then the agent spends inside a cap", basedOn, [ev(src.seq, src.text, /spend_mandate|mandate|max_amount/i)]);
    else if (value === "human_checkout_url") out.payment_entry = rule("payment_entry", value, "partial", "payment is a checkout URL handed to the agent; a human completes it", basedOn, [ev(src.seq, src.text, /checkout|setup_url|payment/i)]);
    else out.payment_entry = rule("payment_entry", value, "unknown", "no payment boundary was reached in this run; nothing observed about how money enters", []);
  }

  // rate_limits_documented: a limit with a number, and Retry-After as a header or field, in what the agent read or received.
  {
    const lim = rs.find((e) => LIMIT_RE.test(e.text));
    const retry = rs.find((e) => RETRY_RE.test(e.text));
    if (!attempted) out.rate_limits_documented = notAttempted("rate_limits_documented");
    else if (lim && retry) out.rate_limits_documented = rule("rate_limits_documented", true, "yes", "a rate limit is stated and Retry-After (header or field) appears in what the agent read or received", [`event:${lim.seq}`, `event:${retry.seq}`], [ev(lim.seq, lim.text, LIMIT_RE), ev(retry.seq, retry.text, RETRY_RE)]);
    else if (lim || retry) out.rate_limits_documented = rule("rate_limits_documented", lim ? "limits_only" : "retry_after_only", "partial", lim ? "a rate limit is stated but Retry-After never appears" : "Retry-After appears but no limit is stated", [`event:${(lim || retry).seq}`], [ev((lim || retry).seq, (lim || retry).text, lim ? LIMIT_RE : RETRY_RE)]);
    else out.rate_limits_documented = rule("rate_limits_documented", null, "unknown", "nothing the agent read or received states a rate limit or Retry-After; the run does not read every docs page", []);
  }

  return { method: "rule", rules: ONBOARDING_RULES, ...Object.fromEntries(ONBOARDING_RULES.map((k) => [k, out[k]])) };
}

// One cell per rule for tables: value·verdict, e.g. "none·yes".
export function onboardingRow(onboarding) {
  const cell = (r) => (r ? `${r.value === null || r.value === undefined ? "-" : String(r.value).replace(/_/g, " ")}·${r.verdict}` : "-");
  return { email: cell(onboarding.email_requirement), bootstrap: cell(onboarding.bootstrap_without_human), expiry: cell(onboarding.expiry_stated_in_response), claim: cell(onboarding.claim_mechanism), gate: cell(onboarding.gate_machine_readable), status: cell(onboarding.status_endpoint), bot: cell(onboarding.bot_check_kind), owner: cell(onboarding.owner_bind_later), pay: cell(onboarding.payment_entry), limits: cell(onboarding.rate_limits_documented) };
}
