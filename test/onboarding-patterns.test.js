import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildInterface } from "../src/interface/index.js";
import { inspect } from "../src/audit/index.js";

// Each agent-first product, recorded from its live public pages (scripts/record-onboarding-fixtures.mjs), must be
// recognised as the onboarding pattern its own docs describe. The expected labels come from reading those docs, not
// from this detector: see docs/onboarding-models-research.md.
const EXPECTED = {
  "neon.com": { primary: "try_then_claim" },
  "mem0.ai": { primary: "try_then_claim", needs: ["cli"] },
  "www.cloudflare.com": { primary: "try_then_claim", needs: ["cli"] },
  "app.tansohq.com": { primary: "try_then_claim" },
  "tansohq.com": { primary: "try_then_claim" },
  "www.cosmicjs.com": { primary: "limited_until_claimed" },
  "agentmail.to": { primary: "limited_until_claimed", also: ["pay_per_request"] },
  "inkbox.ai": { primary: "limited_until_claimed" },
  "telnyx.com": { primary: "agent_is_customer", also: ["pay_per_request"] },
  "aisend.app": { primary: "agent_is_customer" },
  "moltbook.com": { primary: "limited_until_claimed" },
  "projects.dev": { primary: "existing_account", needs: ["cli"] },
  "x402.org": { primary: "pay_per_request" },
};

const replayFrom = (responses) => async (url) => responses[url] || { ok: false, status: 0, url, contentType: "", headers: {}, text: "", error: "not recorded" };

async function inspectFixture(host) {
  const { responses } = JSON.parse(gunzipSync(readFileSync(new URL(`../fixtures/onboarding/${host}.json.gz`, import.meta.url))));
  return buildInterface({ url: `https://${host}/`, version: "test", fetchSource: replayFrom(responses) });
}

for (const [host, expected] of Object.entries(EXPECTED)) {
  test(`${host} is recognised as ${expected.primary}`, async () => {
    const { onboarding, observations } = await inspectFixture(host);
    assert.equal(onboarding.primary, expected.primary, onboarding.patterns.map((p) => p.id).join(", "));
    const ids = onboarding.patterns.map((p) => p.id);
    for (const id of expected.also || []) assert.ok(ids.includes(id), `${host} also supports ${id}`);
    const primary = onboarding.patterns.find((p) => p.id === expected.primary);
    for (const need of expected.needs || []) assert.ok(primary.needs.includes(need), `${host} needs ${need}`);
    // A pattern is a claim the docs make, so each one carries the quote that makes it.
    const ok = new Set(observations.filter((o) => o.ok).map((o) => o.id));
    for (const p of onboarding.patterns) {
      assert.ok(p.evidence.length, `${host} ${p.id} has evidence`);
      for (const e of p.evidence) assert.ok(ok.has(e.obs) && e.quote.length > 0, `${host} ${p.id} quotes a page that was read`);
    }
  });
}

// The near-misses found while building this against real pages. Each would have mislabelled a product.
const pages = (text) => replayFrom({
  "https://example.com/": { ok: true, status: 200, url: "https://example.com/", contentType: "text/plain", headers: {}, text },
});

test("an expiring quote is not an expiring account", async () => {
  const doc = await buildInterface({ url: "https://example.com/", version: "test", fetchSource: pages("Agent signup: POST /v2/agents/sign-up returns a key. Quotes expire after 5 minutes.") });
  assert.equal(doc.onboarding.primary, "agent_is_customer");
});

test("a bare 402 is not pay-per-request, and an agentId field is not agent identity", async () => {
  const doc = await buildInterface({ url: "https://example.com/", version: "test", fetchSource: pages("Agent signup is available. Over the cap, sends fail with HTTP 402 Payment Required. GET /v3/agents/:agentId/messages") });
  const ids = doc.onboarding.patterns.map((p) => p.id);
  assert.ok(!ids.includes("pay_per_request"));
  assert.ok(!ids.includes("agent_identity"));
});

test("no onboarding language means no pattern, and says so without claiming there is none", async () => {
  const doc = await buildInterface({ url: "https://example.com/", version: "test", fetchSource: pages("We make great widgets. Contact sales.") });
  assert.equal(doc.onboarding.primary, null);
  assert.match(doc.onboarding.reason, /not evidence that none exists/);
});

// Products whose pages use agent words for features that are not an agent signing itself up: Postman's and Copilot's
// Agent Mode (Linear, GitHub), Twilio's WhatsApp sender self sign-up. Recorded 2026-10-05; each once read as agent signup.
const AGENT_FIRST = ["try_then_claim", "limited_until_claimed", "agent_is_customer", "agent_identity", "pay_per_request"];
for (const host of ["linear.app", "github.com", "twilio.com"]) {
  test(`${host} is not read as an agent signing itself up`, async () => {
    const { onboarding } = await inspectFixture(host);
    const agentFirst = onboarding.patterns.filter((p) => AGENT_FIRST.includes(p.id)).map((p) => p.id);
    assert.deepEqual(agentFirst, [], agentFirst.join(", "));
  });
}

// The quotes that fooled the detector on live pages, served from an agent-facing page (llms.txt).
const MISLEADING = [
  "Postman Agent Mode Integration – Linear. Connect Linear to Postman Agent Mode.",
  "Once you complete that flow, toggle Agent mode (located by the Copilot Chat text input) and the server will start.",
  "Register WhatsApp senders using Self Sign-up: Learn how to register a WhatsApp sender using the Self Sign-up in the console.",
];
for (const quote of MISLEADING) {
  test(`"${quote.slice(0, 40)}…" is not agent signup`, async () => {
    const pages = { "https://acme.dev/": "<html><head><title>Acme</title></head><body>Acme</body></html>", "https://acme.dev/llms.txt": `# Acme\n\n${quote}\n` };
    const fetchSource = async (url) => (pages[url] ? { ok: true, status: 200, url, contentType: url.endsWith(".txt") ? "text/plain" : "text/html", headers: {}, text: pages[url] } : { ok: false, status: 404, url, contentType: "text/html", headers: {}, text: "" });
    const { onboarding } = await buildInterface({ url: "https://acme.dev/", version: "test", fetchSource });
    assert.deepEqual(onboarding.patterns.filter((p) => AGENT_FIRST.includes(p.id)).map((p) => p.id), []);
  });
}

// A person handing an agent a key, as Buttondown's docs put it, is the person-first pattern, not "no way in".
test("\"manage your API keys at …\" reads as a person setting up access first", async () => {
  const pages = { "https://acme.dev/": "<html><head><title>Acme</title></head><body>Acme</body></html>", "https://acme.dev/llms.txt": "# Acme\n\nYou can manage your API keys at acme.dev/keys. Send the key as Authorization: Token KEY.\n" };
  const fetchSource = async (url) => (pages[url] ? { ok: true, status: 200, url, contentType: url.endsWith(".txt") ? "text/plain" : "text/html", headers: {}, text: pages[url] } : { ok: false, status: 404, url, contentType: "text/html", headers: {}, text: "" });
  const { onboarding } = await buildInterface({ url: "https://acme.dev/", version: "test", fetchSource });
  assert.ok(onboarding.patterns.some((p) => p.id === "existing_account"), onboarding.patterns.map((p) => p.id).join(", "));
});

// A product whose CLI takes a token a person made: the agent runs it unattended. The quotes are from the live docs,
// read 2026-10-05: Vercel's CLI page, GitHub's Copilot CLI setup and `gh auth login` manual.
const llmsOnly = (text) => {
  const pages = { "https://acme.dev/": "<html><head><title>Acme</title></head><body>Acme</body></html>", "https://acme.dev/llms.txt": `# Acme\n\n${text}\n` };
  return async (url) => (pages[url] ? { ok: true, status: 200, url, contentType: url.endsWith(".txt") ? "text/plain" : "text/html", headers: {}, text: pages[url] } : { ok: false, status: 404, url, contentType: "text/html", headers: {}, text: "" });
};
const CLI_TOKEN = [
  "In an environment where manual input is not possible, you can create a token on your tokens page and then authenticate using one of these methods: Set the VERCEL_TOKEN environment variable Pass the --token option to the command",
  "Use the COPILOT_GITHUB_TOKEN , GH_TOKEN , or GITHUB_TOKEN environment variable (in order of precedence).",
  "The default authentication mode is a web-based browser flow. Alternatively, use --with-token to pass in a personal access token (classic) on standard input.",
];
for (const quote of CLI_TOKEN) {
  test(`"${quote.slice(0, 40)}…" reads as a person making a token the agent's CLI uses`, async () => {
    const { onboarding } = await buildInterface({ url: "https://acme.dev/", version: "test", fetchSource: llmsOnly(quote) });
    const existing = onboarding.patterns.find((p) => p.id === "existing_account");
    assert.ok(existing, onboarding.patterns.map((p) => p.id).join(", "));
    assert.equal(existing.cli, "token");
    assert.match(existing.reason, /flag or an environment variable/);
  });
}

test("a CLI that signs in only through a browser is a handoff that says so", async () => {
  const quote = "The command launches a browser window where you authorize the Neon CLI to access your Neon account. You can also authenticate with a Neon API key instead.";
  const { onboarding } = await buildInterface({ url: "https://acme.dev/", version: "test", fetchSource: llmsOnly(quote) });
  assert.equal(onboarding.patterns.find((p) => p.id === "existing_account")?.cli, "browser");
});

// Names in code samples are not the product's CLI reading a token, and "log in" in prose is not a browser login.
test("an _API_KEY in a code sample or a mention of logging in is not read as CLI access", async () => {
  const quote = "export OPENAI_API_KEY=sk-test-123\nnode index.js\n\nYou will need to log in to see your projects.";
  const { onboarding } = await buildInterface({ url: "https://acme.dev/", version: "test", fetchSource: llmsOnly(quote) });
  assert.deepEqual(onboarding.patterns.map((p) => p.id), []);
});

test("the audit's Sign up and Access steps say the agent's CLI takes the token", async () => {
  const { funnel } = await inspect({ url: "https://acme.dev/", version: "test", runId: "r", fetchSource: llmsOnly(CLI_TOKEN[0]) });
  const steps = Object.fromEntries(funnel.steps.map((s) => [s.id, s]));
  assert.equal(steps.signup.state, "handoff");
  assert.match(steps.signup.reason, /CLI takes the token from a flag or an environment variable/);
  assert.equal(steps.access.state, "handoff");
});
