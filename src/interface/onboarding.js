import { htmlToText, registrableDomain, sameSite } from "./sources.js";

// Which ways can an agent start using this product? Read from public docs only, so every pattern is a claim the docs
// make, with the quotes that make it; none is a result. A product can support several. Rules, not a model: each signal
// is a named pattern over page text, and each onboarding pattern is a named combination of signals.

const SIGNALS = {
  // The docs describe an agent getting an account or credential by itself.
  // Not "self sign-up" or "agent mode": real products use both for features unrelated to an agent signing itself up
  // (Twilio's WhatsApp sender self sign-up, Postman's and Copilot's Agent Mode). The code token agent_mode stays.
  bootstrap: /\bagent[- ]?sign[- ]?up\b|\/agents?\/sign-?up\b|\bsign(?:s|ing)? (?:itself|themselves) up\b|\bregisters? itself\b|\bno (?:human|account|signup|sign-up)(?: or API key)? (?:is )?(?:needed|required)\b|\bwithout (?:a |an )?(?:human|account)\b|\banonymous(?:ly)? (?:create|creates|provision|access|account|project|identit)|\btemporary (?:account|project|deployment)s?\b|--temporary\b|\binit --agent\b|\bagent_mode\b|\bbot[_ ]signup\b|\bidentity_types_supported\b/i,
  // A person can take ownership afterwards.
  claim: /\bclaim(?:s|ed|ing)? (?:it|this|the|your|their) (?:account|project|workspace|deployment|bucket|inbox|resources?)\b|\bclaim (?:url|code|link|token|flow|page|email)\b|\bclaim_url\b|\bclaimUrl\b|\/claim\b|\bunclaimed\b|\bclaimable\b|\b(?:human|owner|person) (?:can |may |will )?(?:later )?claim\b|\battach (?:a |the )?(?:human )?owner\b|\badopt (?:the |this )?workspace\b/i,
  // What the agent made goes away unless someone keeps it.
  // Tied to the account or resource: "quotes expire after 5 minutes" is not this.
  expiry: /\b(?:unclaimed|temporary|anonymous)\b[^.]{0,80}\b(?:expire|deleted|removed)|\b(?:account|project|deployment|bucket|workspace)s? (?:expire|are deleted|is deleted)\b[^.]{0,40}\b(?:after|in|within|unless)\b|\bauto-?delet\w*|\b\d+[- ](?:minute|hour|day)s? to claim\b/i,
  // Before a person steps in, the agent can do only part of the job.
  restricted: /\b(?:only|just) (?:send|email|message|write)s? (?:mail |email |messages )?to (?:the|its|your|their) (?:human|owner)\b|\brestricted (?:until|before|to (?:the|its|your) (?:human|owner))\b|\brestrictions? (?:lift|are lifted|are removed)\b|\buntil (?:the )?(?:human|owner|account) (?:verifies|claims|is verified)\b|\buntil (?:verified|claimed|verification)\b|\blimited (?:scope|access) until\b/i,
  // The product asks the agent to prove it is an agent rather than to prove it is a person.
  agentChallenge: /\bbot[_ ]challenge\b|\breverse[- ]captcha\b|\bchallenge_type\b|\bagent[- ]?captcha\b|\bproof[- ]of[- ]work\b/i,
  // Some step goes through an inbox.
  emailStep: /\bmagic link\b|\bverification (?:code|email|link)\b|\bemailed (?:code|OTP|link)\b|\bOTP\b|\breadable (?:mail)?box\b|\bagent inbox\b/i,
  // The agent can add money without a person at a checkout page.
  apiFunding: /\badd (?:USD )?credit programmatically\b|\bno portal funding\b|\bfund (?:the|your) account[^.]{0,60}\b(?:API|programmatically)\b/i,
  // The agent authenticates as itself, with authority delegated by a person.
  // "Agent verified successfully" after a person approves it is a claim step, not this.
  // Case-sensitive: an "agentId" field is an id, not AgentID.
  agentIdentity: /\bAgentID\b|\b[Vv]erified agent identity\b|\b[Aa]gent identity (?:token|assertion|provider)\b|\b[Aa]gent[- ]verified (?:identity|registration|sign-?in)\b/,
  // A person has to set access up before the agent starts.
  humanFirst: /\bmanage (?:your )?API keys? (?:at|in|from|on)\b|\b(?:generate|get|find|create) (?:an |your )?API key (?:in|from|at|on) (?:the |your )?(?:dashboard|console|portal|settings|account)\b|\bcreate (?:an |your )?API key (?:in|from) (?:the |your )?(?:dashboard|console|portal)\b|\b(?:sign|log) ?in to (?:the |your )?(?:dashboard|console|portal)\b|\blink (?:your|a) (?:Stripe )?account\b|\btell the user to complete sign-?in\b|\bbrowser was opened for authentication\b/i,
  // A request is paid for in the request itself. A bare 402 is not this: products also
  // use it to mean "claim first" (Cosmic) or "over your plan" (Inkbox).
  payPerRequest: /\bx402\b|\bX-PAYMENT\b|\bPAYMENT-REQUIRED\b/,
  // The documented way in is a command-line tool rather than an HTTP call.
  cliBootstrap: /\b(?:npx|wrangler|mem0|stripe|npm i(?:nstall)?|pip install|brew install)\b[^\n]{0,60}(?:--temporary|--agent|\binit\b|\bsign-?up\b|projects init)/i,
  httpBootstrap: /\bPOST\s+(?:https?:\/\/\S+)?\/\S*(?:sign-?up|register|agents?)\b|curl -X POST \S*(?:sign-?up|register|agents?)/i,
};

export const PATTERNS = {
  try_then_claim: {
    name: "Try first, claim later",
    humanBoundary: "After the first job, if a person wants to keep what the agent made.",
  },
  limited_until_claimed: {
    name: "Limited until claimed",
    humanBoundary: "Before the agent needs more than the restricted scope allows.",
  },
  agent_is_customer: {
    name: "Agent is the customer",
    humanBoundary: "None documented. The agent signs up and holds the account itself.",
  },
  agent_identity: {
    name: "Agent identity",
    humanBoundary: "When a person delegates authority to the agent, before or outside the session.",
  },
  existing_account: {
    name: "Person sets up access first",
    humanBoundary: "Before the agent starts: a person creates the account or key.",
  },
  pay_per_request: {
    name: "Payment instead of signup",
    humanBoundary: "Only to fund the wallet the agent pays from.",
  },
};

// Pages that exist to tell an agent how to start. A signal quoted from one of these is the product saying so.
const AGENT_FACING = new Set(["onboarding", "auth", "llms_txt", "llms_full", "prm"]);
const EVIDENCE_PER_SIGNAL = 3;

// Starts at a word boundary a little before the match, so the quote reads as text.
function quoteAround(text, index, width = 220) {
  let start = Math.max(0, index - 60);
  if (start > 0) start = Math.min(index, text.indexOf(" ", start) + 1 || index);
  return text.slice(start, start + width).replace(/\s+/g, " ").trim();
}

function findSignals(observations, bodies) {
  const found = Object.fromEntries(Object.keys(SIGNALS).map((name) => [name, []]));
  for (const obs of observations) {
    const body = bodies.get(obs.id);
    if (!body) continue;
    const text = body.html ? htmlToText(body.text) : body.text;
    for (const [name, re] of Object.entries(SIGNALS)) {
      if (found[name].length >= EVIDENCE_PER_SIGNAL) continue;
      const match = re.exec(text);
      if (match) found[name].push({ obs: obs.id, quote: quoteAround(text, match.index), agentFacing: AGENT_FACING.has(obs.role) });
    }
  }
  return found;
}

// What testing this pattern end to end requires beyond HTTP requests: an inbox for an
// email step, a command-line runner, a funded wallet. Whether a deployment has each is
// decided where the report is shown, not here. Agent identity has no runner support.
function needsFor(id, found) {
  const cliOnly = found.cliBootstrap.length > 0 && !found.httpBootstrap.length;
  if (id === "existing_account") return cliOnly ? ["cli"] : [];
  if (id === "pay_per_request") return ["wallet"];
  if (id === "agent_identity") return ["agent_identity"];
  const needs = [];
  if (found.emailStep.length) needs.push("inbox");
  if (cliOnly) needs.push("cli");
  return needs;
}

function pattern(id, found, signalNames, reason) {
  // The product's agent-facing pages first: a quote from llms.txt or an agent-signup
  // page says more than the same words in homepage navigation.
  const entries = signalNames.flatMap((name) => found[name]);
  const evidence = [...entries.filter((e) => e.agentFacing), ...entries.filter((e) => !e.agentFacing)].map(({ obs, quote }) => ({ obs, quote }));
  const documented = signalNames.some((name) => found[name].some((entry) => entry.agentFacing));
  return {
    id,
    name: PATTERNS[id].name,
    status: documented ? "documented" : "inferred",
    reason,
    evidence,
    humanBoundary: PATTERNS[id].humanBoundary,
    needs: needsFor(id, found),
  };
}

// API endpoints the product's agent-facing pages send an agent to on another domain:
// Neon documents on neon.com and takes signups at claimable.neon.tech. Only URLs that
// look like an API (a versioned, /api or /oauth path, or an api./claimable. host) count,
// so links to GitHub or a blog do not. A flow may reach these only because the product
// itself names them here.
const API_URL = /https:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/[^\s"'`<>)\]]*)?/gi;
const API_LOOKING = (host, path) => /^(?:api|claimable|agent|agents)\./.test(host) || /^\/(?:v\d+|api|oauth2?)(?:\/|$)/.test(path || "");
function findApiHosts(doc, bodies) {
  const hosts = new Map();
  for (const obs of doc.observations) {
    const body = bodies.get(obs.id);
    if (!body || !AGENT_FACING.has(obs.role)) continue;
    const text = body.html ? htmlToText(body.text) : body.text;
    for (const match of text.matchAll(API_URL)) {
      const host = match[1].toLowerCase();
      const domain = registrableDomain(host);
      if (hosts.size >= 5 || hosts.has(domain) || sameSite(`https://${host}/`, doc.target.url) || !API_LOOKING(host, match[2])) continue;
      hosts.set(domain, { domain, host, example: match[0].slice(0, 200), evidence: [{ obs: obs.id, quote: quoteAround(text, match.index) }] });
    }
  }
  return [...hosts.values()];
}

export function detectOnboarding(doc, bodies) {
  const observations = doc.observations;
  const found = findSignals(observations, bodies);
  // A signup call documented on a page written for agents is the product saying an agent can sign itself up, even
  // without the words "agent signup": Moltbook's skill.md says "register" and shows POST /api/v1/agents/register.
  found.bootstrap.push(...found.httpBootstrap.filter((e) => e.agentFacing && !found.bootstrap.some((b) => b.obs === e.obs)));
  const has = (name) => found[name].length > 0;
  const patterns = [];

  if (has("bootstrap")) {
    if (has("restricted")) patterns.push(pattern("limited_until_claimed", found, ["bootstrap", "restricted", "claim"], "The docs describe an agent signing itself up with restricted access until a person claims or verifies it."));
    else if (has("claim") || has("expiry")) patterns.push(pattern("try_then_claim", found, ["bootstrap", "claim", "expiry"], "The docs describe an agent getting working access on its own, with a person claiming it afterwards."));
    else patterns.push(pattern("agent_is_customer", found, ["bootstrap", "agentChallenge", "apiFunding"], has("agentChallenge") ? "The docs describe an agent proving it is an agent and holding the account itself; no claim step is mentioned." : "The docs describe an agent signing itself up; no claim step or restriction is mentioned in the sources read."));
  }

  // Protected-resource metadata says how to authenticate, not that an agent can
  // authenticate as itself, so it supports this pattern but never establishes it.
  if (has("agentIdentity")) {
    const p = pattern("agent_identity", found, ["agentIdentity"], "The docs describe an agent authenticating with its own identity.");
    const prm = observations.find((o) => o.ok && o.role === "prm");
    if (prm) p.evidence.push({ obs: prm.id, quote: "/.well-known/oauth-protected-resource" });
    patterns.push(p);
  }

  if (has("payPerRequest")) patterns.push(pattern("pay_per_request", found, ["payPerRequest"], "The docs describe paying per request over HTTP 402, with no account needed first."));

  const schemes = (doc.authentication?.methods || []).filter((m) => ["apiKey", "http", "oauth2"].includes(m.type));
  if (has("humanFirst") || schemes.length) {
    const p = pattern("existing_account", found, ["humanFirst"], has("humanFirst") ? "The docs describe a person creating access (an account, key or payment method) that the agent then uses." : "The API declares credentials in its spec, which an agent can use once a person has created them.");
    if (!p.evidence.length) {
      p.evidence = schemes.flatMap((m) => m.evidence || []).slice(0, EVIDENCE_PER_SIGNAL);
      p.status = "documented";
    }
    patterns.push(p);
  }

  const agentFirst = patterns.find((p) => ["try_then_claim", "limited_until_claimed", "agent_is_customer", "pay_per_request", "agent_identity"].includes(p.id));
  return {
    patterns,
    apiHosts: findApiHosts(doc, bodies),
    primary: agentFirst?.id || patterns[0]?.id || null,
    reason: patterns.length ? `${patterns.length} way${patterns.length === 1 ? "" : "s"} for an agent to start, from the sources read.` : "No way for an agent to start was found in the sources read. This is not evidence that none exists.",
  };
}
