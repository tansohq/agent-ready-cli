import { htmlToText, registrableDomain, sameSite } from "./sources.js";
import { AGENT_FACING, DOMAIN_ACTORS, PROTOCOL_DESCRIPTION, SELLER, paysElsewhere, quoteAround, sentenceAround } from "./onboarding.js";

// Whether the product's own pages document a way for an agent to buy from it through an API, and whether a person
// approves first. Rules over page text, like the onboarding signals: each rule is a named pattern, every hit carries
// its quote, and a hit is a claim the docs make, never a result. Only pages on the product's registrable domain count.

// An agent is the one buying: "An agent can buy runs with POST /v1/purchases", "the agent buys runs", "agents can
// purchase credits". Not "agents cannot buy" (no match), and not a billing product's customers (guarded below).
const AGENT_BUYS = /\b(?:an?|the|your|its) (?:AI )?agents? (?:can |may |then |also )?(?:buy|buys|purchase|purchases|pay for|pays for|top up|tops up)\b/gi;
// How it buys, in the same sentence: a purchase call, a spending cap or a mandate, or a person approving.
const PURCHASE_CALL = /\bPOST\s+`?(?:https?:\/\/([^\s/`]+))?(?:\/[\w.:{}-]+)*\/(?:purchases?|orders?|checkouts?|buy|top-?ups?|credits?)\b/i;
const SPEND_LIMIT = /\b(?:monthly|daily|weekly|spending|budget) (?:cap|limit)\b|\bwithin (?:a|the|its|their) (?:\w+ )?(?:cap|limit|budget)\b|\bmandates?\b/i;
// A person sets payment up once: "a person approves once through an approval link", "402 payment_required with an
// approval_url", "After that approval, the agent buys", a mandate a person signs, Exa's "charged to the card behind the
// delegation". Read within APPROVAL_WINDOW characters of the match, so the next sentence counts too.
const APPROVAL = /\bapprov(?:e|es|ed|al|ing)\b|\bapproval[_ ](?:url|link)\b|\bmandates?\b|\bsaves? (?:a|the) card\b|\bsaved card\b|\bdelegat(?:e|es|ed|ion|ions)\b|\bcard (?:behind|on file)\b|\bcard-on-file\b/i;
const APPROVAL_WINDOW = 300;
// The product answers a purchase it cannot make yet with 402 and a link a person approves: "answers 402
// payment_required with an approval link". A bare 402 is not this: it also means "claim first" (Cosmic) or "over your
// plan" (Inkbox); those sentences name no approval.
const PAYMENT_REQUIRED = /\b402\b|\bpayment_required\b/gi;
// Paying per request in the request itself, on the product's own API: x402 or MPP next to a call that is itself
// paid. A call is paid when its path says so (Telnyx's /v2/machine-payments/account-credit, AgentLine's
// /v1/x402/numbers/buy, Bitrefill's /x402/invoice/create, Exa's /team-management/nevermined/purchase-key), when it is
// the x402 or MPP variant of an endpoint (Keenable's /v1/x402/search, x402.telnyx.com), or when it sits under a
// heading that says the endpoints are paid (AgentCash's "## Paid endpoints (x402 or MPP)"). Calls are written as text
// ("POST /v1/x", "post /v1/x" in OpenAPI YAML) or as OpenAPI JSON keys ("/v1/x":{"post").
const PROTOCOL = /\bx402\b|\bMPP\b/g;
const TEXT_CALL = /\b(?:GET|POST)\s+`?((?:https?:\/\/[^\s/`]+)?\/[\w.:{}/-]*)/gi;
const JSON_CALL = /"(\/[\w.:{}/-]+)"\s*:\s*\{\s*"(?:get|post)"/gi;
const BUY_PATH = /buy|purchase/i;
const PAY_PATH = /pay|top-?up|credit|invoice|charge|checkout|order/i;
const BARE_PROTOCOL_PATH = /(?<![\w/.:-])(\/(?:v\d+|api)(?:\/[\w.:{}-]+)*\/(?:x402|mpp)\/[\w.:{}/-]+)/gi;
const PROTOCOL_PATH = /(?:^|\/|\.)(?:x402|mpp)(?:\/|\.|$)/i;
// Not a paid call: signing a payment to someone else (Neynar's /v2/signature/x402/), the facilitator's verify and
// settle, registering with a directory, and listings (Locus's /api/x402/endpoints/md, an openapi.json).
const NOT_PAID_PATH = /\/(?:sign(?:ature)?s?|verify|settle|facilitator|registry|register[\w-]*|endpoints|catalog|discovery|list|index|openapi|\.well-known|status|info|details?|events?)(?:\/|\.|$)|\.(?:md|json|ya?ml|txt)$/i;
const PAID_HEADING = /\bpaid\b|\bpay[- ]per[- ](?:call|request|use)\b/i;
const HEADING = /(?:^|\n|\\n)#{1,6}[ \t]+([^\n\\]+)/g;
// A seller's code or page: x402.org's quickstart for sellers configures paymentMiddleware with "GET /weather" and payTo.
const SELLER_SAMPLE = /\bpaymentMiddleware\b|\bpayTo\b|\bfacilitator\b|\bfor sellers\b|\baccept(?:ing)? payments\b|\bmonetiz/i;
// A wallet or proxy page: the agent pays other x402 services through the product (Locus's "Call any x402 URL", its x402
// catalog and wrapped APIs). A paid call there pays a third party, not this product.
const PROXY_PAGE = /\bany x402[- ](?:enabled )?(?:HTTPS )?(?:URL|endpoint|service)s?\b|\bx402 catalog\b|\bwrapped APIs?\b|\bconfigured x402 services\b/i;
const SELLER_PAGE = /sellers?|merchants?|monetiz|\/(?:templates?|examples?|starters?)\//i;
const URL_HOST = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
// Agent-commerce products sell the same words to stores: "let AI agents buy from your store", "agents purchase on
// your site". The reader's store is not this product.
const BUYS_ELSEWHERE = /\b(?:from|on|in|at) your (?:store|shop|site|website|app|business|platform|product|catalog|checkout)\b|\b(?:merchants?|sellers?)\b/i;
// "does not authorize a purchase", "An agent cannot ... approve on its own": the sentence says it is not a way to buy.
const NOT_A_PURCHASE = /\b(?:not|never|no|cannot|can't)\b[^.]{0,40}\b(?:buy|purchase|pay)\b/i;
const EVIDENCE_MAX = 3;
const MAX_TRIED = 200;

// A URL in the sentence on another registrable domain means the purchase is somewhere else. The protocols' own
// sites are only described, so they do not count.
function namesOtherSite(sentence, ownDomain) {
  return [...sentence.matchAll(URL_HOST)].some((m) => {
    const domain = registrableDomain(m[1].toLowerCase());
    return domain !== ownDomain && domain !== "x402.org" && domain !== "mpp.dev";
  });
}

function aboutSomethingElse(sentence, ownDomain) {
  return DOMAIN_ACTORS.test(sentence) || SELLER.test(sentence) || BUYS_ELSEWHERE.test(sentence) || paysElsewhere(sentence, ownDomain) || namesOtherSite(sentence, ownDomain);
}

// The best paid call in a raw sentence: 4 for a buying path, 3 for another paying path, 2 for an x402 or MPP variant,
// 1 under a paid heading. A bare path counts only when it is an API path (/v1/…, /api/…) to an x402 or MPP variant
// ("/v1/x402/search"); docs links such as /integrations/x402/agentkit are not calls.
function paidCall(raw) {
  let best = null;
  const calls = [...[...raw.matchAll(TEXT_CALL)].map((m) => ({ at: m.index, url: m[1], text: m[0] })), ...[...raw.matchAll(JSON_CALL)].map((m) => ({ at: m.index, url: m[1], text: m[0] })), ...[...raw.matchAll(BARE_PROTOCOL_PATH)].map((m) => ({ at: m.index, url: m[1], text: `POST ${m[1]}` }))];
  for (const c of calls) {
    const path = c.url.replace(/^https?:\/\/[^/]+/, "").replace(/[.:,;]+$/, "");
    const host = /^https?:\/\/([^/]+)/.exec(c.url)?.[1] || "";
    if (NOT_PAID_PATH.test(path)) continue;
    const heading = [...raw.slice(0, c.at).matchAll(HEADING)].at(-1)?.[1] || "";
    const score = BUY_PATH.test(path) ? 4 : PAY_PATH.test(path) ? 3 : PROTOCOL_PATH.test(path) || PROTOCOL_PATH.test(host) ? 2 : PAID_HEADING.test(heading) ? 1 : 0;
    if (score && (!best || score > best.score)) best = { ...c, path, score };
  }
  return best;
}

// A heading line and the text under it, up to the next heading or SECTION_MAX characters.
const SECTION_MAX = 1500;
function section(text, start) {
  const rest = text.slice(start, start + SECTION_MAX);
  const next = rest.slice(1).search(/\n#{1,6}[ \t]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const RULES = {
  // An agent buying, with the call, a cap or an approval in the same sentence.
  agent_buys_through_api: (text, ownDomain) => {
    for (const m of take(text, AGENT_BUYS)) {
      const sentence = sentenceAround(text, m.index, m.index + m[0].length).replace(/\s+/g, " ");
      if (aboutSomethingElse(sentence, ownDomain) || NOT_A_PURCHASE.test(sentence)) continue;
      if (PURCHASE_CALL.test(sentence) || SPEND_LIMIT.test(sentence) || APPROVAL.test(sentence)) return { index: m.index, sentence, call: callIn(sentence), score: 3 };
    }
    return null;
  },
  // 402 with a link or step a person approves.
  payment_required_approval: (text, ownDomain) => {
    for (const m of take(text, PAYMENT_REQUIRED)) {
      const sentence = sentenceAround(text, m.index, m.index + m[0].length).replace(/\s+/g, " ");
      if (aboutSomethingElse(sentence, ownDomain)) continue;
      if (/\bapproval[_ ](?:url|link)\b|\b(?:person|owner|human) (?:can )?approves?\b/i.test(sentence)) return { index: m.index, sentence, call: null, score: 3, approved: true };
    }
    return null;
  },
  // x402 or MPP next to a paid call on the product's own API. Every match on the page is tried and the best call kept,
  // so AgentLine's quote is its number purchase, not a polling endpoint in the same tag.
  pay_per_request_own_api: (text, ownDomain) => {
    let best = null;
    for (const m of take(text, PROTOCOL)) {
      // On a markdown heading line ("## Paid endpoints (x402 or MPP)"), the calls are in the section under it.
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      const line = text.slice(lineStart, (text.indexOf("\n", m.index) + 1 || text.length + 1) - 1);
      const raw = /^#{1,6}[ \t]/.test(line) ? section(text, lineStart) : sentenceAround(text, m.index, m.index + m[0].length);
      const sentence = raw.replace(/\s+/g, " ");
      if (aboutSomethingElse(sentence, ownDomain) || PROTOCOL_DESCRIPTION.test(sentence) || SELLER_SAMPLE.test(sentence)) continue;
      const call = paidCall(raw);
      if (!call || (best && call.score <= best.score)) continue;
      const start = text.indexOf(raw, Math.max(0, m.index - raw.length));
      best = { index: start >= 0 ? start + call.at : m.index, sentence, call: `${call.text.match(/^\w+/)?.[0]?.toUpperCase() === "GET" || /"get"/i.test(call.text) ? "GET" : "POST"} ${call.path}`, score: call.score };
      if (best.score === 4) break;
    }
    return best;
  },
};

// "POST /v1/purchases" from the sentence, without a scheme or host, or null.
function callIn(sentence) {
  const m = PURCHASE_CALL.exec(sentence);
  return m ? m[0].replace(/`/g, "").replace(/https?:\/\/[^/\s]+/, "") : null;
}

function* take(text, re) {
  let tried = 0;
  for (const m of text.matchAll(re)) {
    yield m;
    tried += 1;
    if (tried >= MAX_TRIED) return;
  }
}

// { rule, rules, approval, call, evidence: [{ obs, quote }] } or null. call is the purchase or paid call an agent makes,
// when a quoted sentence names one. approval: "once" when a person sets payment up first near any hit (an approval
// link, a cap a person sets, a mandate, a delegation, a saved card), else "none_documented".
export function detectAgentPurchase(doc, bodies) {
  const ownDomain = registrableDomain(new URL(doc.target.url).hostname);
  const hits = [];
  for (const obs of doc.observations) {
    const body = bodies.get(obs.id);
    if (!body || !obs.ok || !sameSite(obs.url, doc.target.url) || obs.role === "sitemap") continue;
    const text = body.html ? htmlToText(body.text) : body.text;
    const sellerPage = SELLER_PAGE.test(new URL(obs.url).pathname);
    for (const [rule, find] of Object.entries(RULES)) {
      if (rule === "pay_per_request_own_api" && (sellerPage || PROXY_PAGE.test(text))) continue;
      if (hits.filter((h) => h.rule === rule).length >= EVIDENCE_MAX) continue;
      const hit = find(text, ownDomain);
      if (!hit) continue;
      const near = text.slice(Math.max(0, hit.index - APPROVAL_WINDOW), hit.index + APPROVAL_WINDOW);
      hits.push({ rule, obs: obs.id, quote: quoteAround(text, hit.index), approval: Boolean(hit.approved) || APPROVAL.test(hit.sentence) || APPROVAL.test(near), call: hit.call, score: hit.score, agentFacing: AGENT_FACING.has(obs.role) });
    }
  }
  if (!hits.length) return null;
  // An agent buying through the API is the strongest claim; 402 with approval alone still says how a purchase goes.
  const order = ["agent_buys_through_api", "payment_required_approval", "pay_per_request_own_api"];
  const rule = order.find((r) => hits.some((h) => h.rule === r));
  // The strongest call first, then quotes from pages written for agents.
  const ordered = [...hits].sort((a, b) => b.score - a.score || Number(b.agentFacing) - Number(a.agentFacing));
  const ruled = ordered.filter((h) => h.rule === rule);
  return {
    rule,
    rules: [...new Set(hits.map((h) => h.rule))],
    approval: hits.some((h) => h.approval) ? "once" : "none_documented",
    call: ruled.find((h) => h.call)?.call || null,
    evidence: ordered.filter((h) => h.rule === rule).concat(ordered.filter((h) => h.rule !== rule)).slice(0, EVIDENCE_MAX * 2).map(({ obs, quote }) => ({ obs, quote })),
  };
}
