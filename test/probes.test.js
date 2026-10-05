import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runProbes } from "../src/probe/index.js";

// Two fake sites on two ports: GOOD is agent-ready, BAD is hostile (probes resolve paths from the host root).
const GOOD = {
  "/robots.txt": ["text/plain", "User-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\n# see /llms.txt\nUser-agent: *\nAllow: /\n"],
  "/.well-known/agent.json": ["application/json", JSON.stringify({ name: "Good", signup: "/v1/accounts" })],
  "/llms.txt": ["text/plain", "# Good\n\n" + "- [Docs](/docs.md)\n".repeat(20)],
  "/openapi.json": ["application/json", JSON.stringify({ openapi: "3.1.0", paths: { "/v1/accounts": { post: { responses: { 201: { description: "returns api_key" } } } }, "/v1/subscriptions": { post: { responses: { 201: {}, 402: { description: "payment required" } } } } } })],
  "/pricing.json": ["application/json", JSON.stringify({ $schema: "x", product: { name: "Good", vendor: "Good", category: "saas" }, revenue_model: { type: "flat", billing_frequency: ["month"] }, plans: [{ id: "free", name: "Free", price: { amount: 0, currency: "USD" }, trial: { api_provisioning_url: "https://good.test/v1/accounts" } }] })],
  "/signup": ["text/html", "<!doctype html><html><body><form method=post action=/v1/accounts><input name=email></form></body></html>"],
};
// A product whose spec is published where a guessed path will never find it,
// and one that speaks GraphQL instead of REST.
const LINKED = {
  "/llms.txt": ["text/plain", "# Linked\n\n- [API spec](http://SPEC_HOST/schema/openapi.json)\n"],
};
const SPEC = {
  "/schema/openapi.json": ["application/json", JSON.stringify({ openapi: "3.1.0", paths: { "/v1/things": { get: {} } } })],
};
const GRAPHQL = {
  "/graphql": ["application/json", JSON.stringify({ errors: [{ message: "Must provide query string" }] })],
};

const BAD = {
  "/robots.txt": ["text/plain", "User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\nUser-agent: CCBot\nDisallow: /\nUser-agent: *\nAllow: /\n"],
  "/llms.txt": ["text/html", "<!doctype html><html><body>404</body></html>"],
  "/signup": ["text/html", "<!doctype html><html><head><script src='https://www.google.com/recaptcha/api.js'></script></head><body><form></form></body></html>"],
};

// A single-page app: every path answers 200 with the same shell. This is what
// most real products do, and it is the case where a status code alone lies.
function serveSpa() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html><body><div id=root></div></body></html>");
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

function serve(table) {
  const server = createServer((req, res) => {
    const hit = table[req.url.split("?")[0]];
    if (!hit) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<!doctype html><html><body>404</body></html>");
    }
    res.writeHead(200, { "content-type": hit[0] });
    res.end(hit[1]);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

let good;
let bad;
let spa;
let linked;
let spec;
let graphql;
before(async () => {
  good = await serve(GOOD);
  bad = await serve(BAD);
  spa = await serveSpa();
  spec = await serve(SPEC);
  linked = await serve({ "/llms.txt": ["text/plain", LINKED["/llms.txt"][1].replace("SPEC_HOST", new URL(spec.base).host)] });
  graphql = await serve(GRAPHQL);
});
after(() => {
  good.server.close();
  bad.server.close();
  spa.server.close();
  linked.server.close();
  spec.server.close();
  graphql.server.close();
});

const byId = (list, id) => list.find((p) => p.id === id);

describe("probes against an agent-ready site", () => {
  it("passes discovery, pricing, signup and 402 probes", async () => {
    const probes = await runProbes(good.base);
    assert.equal(byId(probes, "robots_ai").status, "pass");
    assert.equal(byId(probes, "agent_json").status, "pass");
    assert.equal(byId(probes, "llms_txt").status, "pass");
    assert.equal(byId(probes, "openapi").status, "pass");
    assert.equal(byId(probes, "pricing_json").status, "pass");
    assert.equal(byId(probes, "catalog_pricing").status, "skip");
    assert.equal(byId(probes, "captcha").status, "pass");
    const signup = byId(probes, "signup_endpoint");
    assert.equal(signup.status, "pass");
    assert.equal(signup.data.returnsKey, true);
    assert.equal(byId(probes, "http_402").status, "pass");
    assert.ok(probes.every((p) => !p.data?.doc), "openapi doc must not leak into scan.json");
  });
});

describe("probes against a hostile site", () => {
  it("fails robots, llms.txt, captcha; skips 402 without OpenAPI", async () => {
    const probes = await runProbes(bad.base);
    assert.equal(byId(probes, "robots_ai").status, "fail");
    assert.equal(byId(probes, "agent_json").status, "fail");
    assert.equal(byId(probes, "llms_txt").status, "fail");
    assert.equal(byId(probes, "openapi").status, "fail");
    assert.equal(byId(probes, "pricing_json").status, "fail");
    assert.equal(byId(probes, "captcha").status, "fail");
    assert.match(byId(probes, "captcha").detail, /recaptcha/);
    assert.equal(byId(probes, "signup_endpoint").status, "warn");
    assert.equal(byId(probes, "http_402").status, "skip");
  });
});

describe("probes against a single-page app", () => {
  it("says a 200 served HTML instead of reporting the status alone", async () => {
    const probes = await runProbes(spa.base);
    const pricing = byId(probes, "pricing_json");
    assert.equal(pricing.status, "fail");
    assert.match(pricing.detail, /serves HTML, not pricing JSON/);
    assert.doesNotMatch(pricing.detail, /^\/pricing\.json 200$/, "a bare 200 reads as a pass");
  });
});

describe("finding an API description that is not at a guessed path", () => {
  it("follows a spec link from /llms.txt, including to another host", async () => {
    const { openapi } = await import("../src/probe/index.js");
    const probe = await openapi(linked.base);
    assert.equal(probe.status, "pass");
    assert.match(probe.detail, /OpenAPI 3\.1\.0/);
    assert.match(probe.detail, /linked from \/llms\.txt/);
  });

  it("counts a GraphQL endpoint as a machine-readable interface", async () => {
    const { openapi } = await import("../src/probe/index.js");
    const probe = await openapi(graphql.base);
    assert.equal(probe.status, "pass");
    assert.equal(probe.data.kind, "graphql");
  });

  it("says where it looked when it finds nothing", async () => {
    const { openapi } = await import("../src/probe/index.js");
    const probe = await openapi(bad.base);
    assert.equal(probe.status, "fail");
    assert.match(probe.detail, /no spec linked from \/llms\.txt/);
    assert.match(probe.detail, /GraphQL/);
  });
});
