import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { inspect } from "../src/audit/index.js";

// Pay reads a purchase the product's own pages document. tansohq.com (recorded 2026-10-07) says an agent buys hosted
// test runs with POST /v1/purchases within a monthly cap a person approves once, and that a run needing payment
// answers 402 payment_required with an approval link. Before this rule Pay read "nothing documents a way for an agent
// to buy one".

const replayFrom = (responses) => async (url) => responses[url] || { ok: false, status: 0, url, contentType: "", headers: {}, text: "", error: "not recorded" };
const fixture = (host) => replayFrom(JSON.parse(gunzipSync(readFileSync(new URL(`../fixtures/onboarding/${host}.json.gz`, import.meta.url)))).responses);
const llmsOnly = (text, plans = true) => {
  const pages = {
    "https://acme.dev/": "<html><head><title>Acme</title></head><body>Acme</body></html>",
    "https://acme.dev/llms.txt": `# Acme\n\n${plans ? "Pro plan: $20 per month.\n\n" : ""}${text}\n`,
  };
  return async (url) => (pages[url] ? { ok: true, status: 200, url, contentType: url.endsWith(".txt") ? "text/plain" : "text/html", headers: {}, text: pages[url] } : { ok: false, status: 404, url, contentType: "text/html", headers: {}, text: "" });
};
const payStep = async (fetchSource, url = "https://acme.dev/") => {
  const { doc, funnel } = await inspect({ url, version: "test", runId: "r", fetchSource });
  return { doc, pay: funnel.steps.find((s) => s.id === "pay") };
};

test("tansohq.com: a person approves once, then the agent buys with POST /v1/purchases", async () => {
  const { doc, pay } = await payStep(fixture("tansohq.com"), "https://tansohq.com/");
  assert.equal(doc.pricing.agentPurchase.rule, "agent_buys_through_api");
  assert.equal(doc.pricing.agentPurchase.approval, "once");
  assert.equal(doc.pricing.agentPurchase.call, "POST /v1/purchases");
  assert.equal(pay.state, "handoff");
  assert.match(pay.reason, /A person sets payment up once .* then the agent buys through POST \/v1\/purchases, with no browser checkout/);
  assert.equal(pay.fix, undefined);
  const llms = doc.observations.find((o) => o.url === "https://tansohq.com/llms.txt");
  assert.ok(pay.basedOn.includes(llms.id), pay.basedOn.join(","));
  assert.ok(doc.pricing.agentPurchase.evidence.some((e) => /An agent can buy runs with POST \/v1\/purchases within a monthly cap/.test(e.quote)));
});

test("marginfront.com: a billing product's agents and subscriptions are not a purchase", async () => {
  const { doc, pay } = await payStep(fixture("marginfront.com"), "https://marginfront.com/");
  assert.equal(doc.pricing.agentPurchase, null);
  assert.notEqual(pay.state, "handoff");
  assert.notEqual(pay.state, "agent_can");
});

// The words a billing or agent-commerce product uses about its own customers, and sentences that say no.
const NOT_A_PURCHASE = [
  "Your customers can let an agent buy credits with POST /v1/purchases within a monthly cap.",
  "Let an agent buy from your store within a spending limit you set.",
  "Monetize your API: an agent can pay for each call over x402 with POST /v1/search.",
  "An agent can buy credits with POST https://shop.example.org/v1/purchases within a cap.",
  "Contacting Acme does not authorize a purchase. This does not let the agent buy credits within a cap.",
  "Over the cap, sends fail with HTTP 402 Payment Required.",
  "Create a subscription for the customer with POST /v1/subscriptions.",
  "x402 is the internet's payment standard for agentic payments, see POST /v1/settle.",
];
for (const quote of NOT_A_PURCHASE) {
  test(`"${quote.slice(0, 48)}…" is not a documented agent purchase`, async () => {
    const { doc, pay } = await payStep(llmsOnly(quote));
    assert.equal(doc.pricing.agentPurchase, null, JSON.stringify(doc.pricing.agentPurchase));
    assert.ok(!["agent_can", "handoff"].includes(pay.state), pay.reason);
  });
}

test("an agent buying through the API with no approval named reads as agent_can", async () => {
  const { pay } = await payStep(llmsOnly("An agent can buy credits with POST /v1/credits and starts using them at once."));
  assert.equal(pay.state, "agent_can");
  assert.match(pay.reason, /an agent buying through the API \(POST \/v1\/credits\), and no person approving first/);
});

test("402 payment_required with an approval link reads as a handoff", async () => {
  const { doc, pay } = await payStep(llmsOnly("When a job needs payment, the API answers 402 payment_required with an approval_url the person opens."));
  assert.equal(doc.pricing.agentPurchase.rule, "payment_required_approval");
  assert.equal(pay.state, "handoff");
  assert.match(pay.reason, /then the agent buys through the API/);
});

test("a paid x402 call on the product's own API reads as agent_can; on another site it does not", async () => {
  const own = await payStep(llmsOnly("Search without an account: POST https://api.acme.dev/v1/x402/search pays per request over x402."));
  assert.equal(own.doc.pricing.agentPurchase.rule, "pay_per_request_own_api");
  assert.equal(own.doc.pricing.agentPurchase.call, "POST /v1/x402/search");
  assert.equal(own.pay.state, "agent_can");
  assert.match(own.pay.reason, /a paid call over x402 or MPP on the product's own API \(POST \/v1\/x402\/search\)/);
  assert.doesNotMatch(own.pay.reason, /no account/);
  const other = await payStep(llmsOnly("Search without an account: POST https://api.example.org/v1/x402/search pays per request over x402."));
  assert.equal(other.doc.pricing.agentPurchase, null);
  assert.equal(other.pay.state, "not_checked");
});

// What makes a call paid: its path, an x402 or MPP variant, or a heading that says the endpoints are paid.
const PAID_CALLS = [
  ["Top up with x402: POST /v2/x402/credit_account.", "POST /v2/x402/credit_account"],
  ["## Paid endpoints (x402 or MPP)\n- POST /api/send: send USDC", "POST /api/send"],
  ['{"paths":{"/v1/x402/numbers/buy":{"post":{"tags":["x402 Keyless"]}}}}', "POST /v1/x402/numbers/buy"],
  ["Search: POST /v1/search /v1/x402/search", "POST /v1/x402/search"],
];
for (const [quote, call] of PAID_CALLS) {
  test(`"${quote.slice(0, 44)}…" is a paid call`, async () => {
    const { doc } = await payStep(llmsOnly(quote));
    assert.equal(doc.pricing.agentPurchase?.call, call, JSON.stringify(doc.pricing.agentPurchase));
  });
}

// Next to x402 but not a paid call on this product: a free call, a seller's code sample, signing a payment for someone
// else, a listing, a docs link, and a wallet that pays other x402 services.
const NOT_PAID = [
  "GET /v1/search works with an API key. x402 is supported.",
  'app.use(paymentMiddleware({ "POST /api/buy": { accepts: [{ scheme: "exact", price: "$0.001" }] } }, payTo)); // x402',
  "post /v2/signature/x402/ signs an x402 payment for a user.",
  "Fetch the x402 catalog with `GET /api/x402/endpoints/md`.",
  "See the [x402 guide](/integrations/x402/agentkit).",
  "Call any x402 URL through the wallet: POST /api/x402/laso-send-payment pays Laso for you.",
];
for (const quote of NOT_PAID) {
  test(`"${quote.slice(0, 44)}…" is not a paid call on this product`, async () => {
    const { doc } = await payStep(llmsOnly(quote));
    assert.equal(doc.pricing.agentPurchase, null, JSON.stringify(doc.pricing.agentPurchase));
  });
}

test("a paid x402 call on a page for sellers is the reader's API, not this product's", async () => {
  const sellerPage = "https://acme.dev/docs/x402/quickstart-for-sellers";
  const pages = {
    "https://acme.dev/": "<html><head><title>Acme</title></head><body>Acme</body></html>",
    "https://acme.dev/llms.txt": `# Acme\n\nPro plan: $20 per month.\n\n- [Quickstart](${sellerPage})\n`,
    [sellerPage]: "# Quickstart\n\nYour route POST /v1/x402/buy answers 402 until the x402 payment settles.\n",
  };
  const fetchSource = async (url) => (pages[url] ? { ok: true, status: 200, url, contentType: url.endsWith("/") ? "text/html" : "text/plain", headers: {}, text: pages[url] } : { ok: false, status: 404, url, contentType: "text/html", headers: {}, text: "" });
  const { doc } = await payStep(fetchSource);
  assert.ok(doc.observations.some((o) => o.url === sellerPage && o.ok), "the seller page was read");
  assert.equal(doc.pricing.agentPurchase, null, JSON.stringify(doc.pricing.agentPurchase));
});

test("a delegation or saved card near a paid x402 call makes it a handoff", async () => {
  const { doc, pay } = await payStep(llmsOnly("Buy a key: POST /v1/keys/purchase with an x402 token.\n\nCost: $7, charged to the card behind the delegation."));
  assert.equal(doc.pricing.agentPurchase.approval, "once");
  assert.equal(pay.state, "handoff");
  assert.match(pay.reason, /then the agent pays over x402 or MPP \(POST \/v1\/keys\/purchase\), with no browser checkout/);
});

// Recorded by QA for PR #80 on 2026-10-07 (fixtures/pay/, page text cut at 150,000 characters, Exa's llms-full.txt at
// 450,000 so its purchase section stays).
const PAY_FIXTURES = {
  "x402.org": { purchase: null },
  "neynar.com": { purchase: null },
  "paywithlocus.com": { purchase: null },
  "exa.ai": { state: "handoff", call: "POST /team-management/nevermined/purchase-key" },
  "agentline.cloud": { state: "agent_can", call: "POST /v1/x402/numbers/buy" },
  "bitrefill.com": { state: "agent_can", call: "POST /x402/invoice/create" },
};
for (const [host, expected] of Object.entries(PAY_FIXTURES)) {
  test(`${host} (QA recording): Pay reads ${expected.state || "no purchase"}`, async () => {
    const { url, responses } = JSON.parse(gunzipSync(readFileSync(new URL(`../fixtures/pay/${host}.json.gz`, import.meta.url))));
    const { doc, pay } = await payStep(replayFrom(responses), url);
    if (expected.purchase === null) {
      assert.equal(doc.pricing.agentPurchase, null, JSON.stringify(doc.pricing.agentPurchase));
      assert.ok(!["agent_can", "handoff"].includes(pay.state), pay.reason);
      return;
    }
    assert.equal(pay.state, expected.state, pay.reason);
    assert.equal(doc.pricing.agentPurchase.call, expected.call);
    assert.ok(doc.pricing.agentPurchase.evidence[0].quote.includes(expected.call.split(" ")[1]), doc.pricing.agentPurchase.evidence[0].quote);
  });
}

test("x402 named with no call on the product's API stays a mention a test has to settle", async () => {
  const { doc, pay } = await payStep(llmsOnly("Agents can pay per request with x402, no account needed."));
  assert.equal(doc.pricing.agentPurchase, null);
  assert.equal(pay.state, "not_checked");
  assert.match(pay.reason, /mention paying per request/);
});
