import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFunnel } from "../src/interface/funnel.js";
import { buildAudit, basisFor, renderBrief, inspect, parseTarget, productName } from "../src/audit/index.js";
import { defaultAnswers, askQuestions } from "../src/audit/questions.js";
import { PassThrough } from "node:stream";
import { renderPrompt } from "../src/audit/prompts.js";
import { readConfig, writeConfig } from "../src/audit/config.js";
import { patternInfo } from "../src/audit/index.js";
import { wrap, makeStyle, renderVerdict, renderSteps } from "../src/audit/render.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const verdict = (v, reason = "because", basedOn = ["obs_1"]) => ({ verdict: v, reason, basedOn, rule: "r", method: "rule" });

function doc(overrides = {}) {
  return {
    target: { url: "https://acme.dev/", host: "acme.dev" },
    product: { name: { value: "Acme" } },
    observations: [{ id: "obs_1", role: "homepage", ok: true, status: 200, url: "https://acme.dev/" }],
    machineAccess: { aiCrawlersAllowed: verdict("yes"), hasAgentReadableIndex: verdict("yes", "/llms.txt with 3 links") },
    pricing: { agentCanDetermineCost: verdict("yes", "2 plan(s) with amounts in pricing.json"), ambiguities: [], plans: [{ id: "pro", amount: 20, evidence: [{ obs: "obs_1" }] }] },
    onboarding: { patterns: [] },
    authentication: { methods: [{ value: { type: "apiKey" } }], requirement: { value: "required", basedOn: [] } },
    capabilities: [{ name: "Create project", evidence: [{ obs: "obs_1" }] }],
    interfaces: { api: { exists: verdict("yes"), machineReadableSpec: verdict("yes") } },
    limits: ["GET requests only"],
    ...overrides,
  };
}

const answersFor = (funnel, over = {}) => ({ ...defaultAnswers(funnel), ...over });

describe("audit: findings and the onboarding model", () => {
  it("recommends try first, claim later when the docs describe no agent signup, and says it is a recommendation", () => {
    const none = buildFunnel(doc({ onboarding: { patterns: [] } }));
    assert.deepEqual(defaultAnswers(none).onboarding, { value: "try_then_claim", source: "recommended" });
  });

  it("keeps the documented pattern as the default when the docs describe one", () => {
    const d = doc({ onboarding: { patterns: [{ id: "try_then_claim", name: "Try first, claim later", status: "documented", humanBoundary: "After the first job.", needs: [], evidence: [{ obs: "obs_1" }] }] } });
    assert.deepEqual(defaultAnswers(buildFunnel(d)).onboarding, { value: "try_then_claim", source: "documented" });
  });

  it("makes one finding per step that needs a person or is blocked, ranked by severity label, never for manage", () => {
    const d = doc({ machineAccess: { aiCrawlersAllowed: verdict("no", "GPTBot is disallowed"), hasAgentReadableIndex: verdict("no") } });
    const funnel = buildFunnel(d);
    const audit = buildAudit({ doc: d, funnel, answers: answersFor(funnel), task: "t", runId: "run_1", version: "test" });
    const discover = audit.findings.find((f) => f.step === "discover");
    assert.equal(discover.severity, "high");
    assert.equal(discover.file, "01-discover.md");
    assert.ok(!audit.findings.some((f) => f.step === "manage"));
  });

  it("a person-first product gets a signup fix when the owner chooses an agent-first model, and none otherwise", () => {
    const d = doc({ onboarding: { patterns: [{ id: "existing_account", name: "Person sets up access first", status: "documented", needs: [], evidence: [{ obs: "obs_1" }] }] } });
    const funnel = buildFunnel(d);
    const personFirst = buildAudit({ doc: d, funnel, answers: answersFor(funnel), task: "t", runId: "r", version: "test" });
    assert.ok(!personFirst.findings.some((f) => f.step === "signup"));
    const tryFirst = buildAudit({ doc: d, funnel, answers: answersFor(funnel, { onboarding: { value: "try_then_claim", source: "asked" } }), task: "t", runId: "r", version: "test" });
    const signup = tryFirst.findings.find((f) => f.step === "signup");
    assert.equal(signup.severity, "medium");
    assert.match(signup.reason, /Your onboarding model is Try first, claim later/);
  });

  it("lists Use before Pay, because agents use a product before they pay for it", () => {
    const funnel = buildFunnel(doc());
    const ids = funnel.steps.map((s) => s.id);
    assert.ok(ids.indexOf("use") < ids.indexOf("pay"));
  });

  it("never reports a step as verified from public pages", () => {
    const d = doc();
    const funnel = buildFunnel(d);
    for (const s of funnel.steps) assert.notEqual(basisFor(s, d), "verified");
    assert.equal(basisFor(funnel.steps.find((s) => s.id === "manage"), d), "not_checked");
    assert.equal(basisFor(funnel.steps.find((s) => s.id === "discover"), d), "observed");
  });
});

describe("audit: fix prompts", () => {
  const finding = { n: 1, step: "signup", name: "Sign up", severity: "medium", reason: "No way for an agent to sign up is documented.", basedOn: ["obs_1"] };

  it("a try-first prompt carries endpoints, security and acceptance tests, and tells the agent to reuse the repo's code", () => {
    const body = renderPrompt({ finding, pattern: patternInfo("try_then_claim"), answers: { abuse_cost: { value: "low" }, human_before: { value: "never" } }, doc: doc(), product: "Acme", url: "https://acme.dev/" });
    assert.match(body, /POST \/v1\/agent\/signup/);
    assert.match(body, /Reuse its existing web framework, auth, API-key and billing code/);
    assert.match(body, /## Acceptance tests/);
    assert.match(body, /never trust a client-appended X-Forwarded-For/);
    assert.match(body, /Evidence: https:\/\/acme\.dev\//);
    assert.match(body, /## Check first\nThe audit did not find an agent signup path/);
    assert.doesNotMatch(body, /proof-of-work challenge; signup requires/);
  });

  it("the owner's verified-person rule reaches every prompt, not only signup", () => {
    const pay = { n: 1, step: "pay", name: "Pay", severity: "medium", reason: "No agent purchase path.", basedOn: ["obs_1"] };
    const always = renderPrompt({ finding: pay, pattern: patternInfo("existing_account"), answers: { abuse_cost: { value: "low" }, human_before: { value: "always" } }, doc: doc(), product: "Acme", url: "https://acme.dev/" });
    assert.match(always, /A verified person must own the account before an agent can do anything with it/);
    const never = renderPrompt({ finding: pay, pattern: patternInfo("existing_account"), answers: { abuse_cost: { value: "low" }, human_before: { value: "never" } }, doc: doc(), product: "Acme", url: "https://acme.dev/" });
    assert.doesNotMatch(never, /verified person must own/);
    assert.match(never, /Fit them to the API's existing paths/);
  });

  it("a high abuse cost adds a proof-of-work challenge, never a CAPTCHA", () => {
    const body = renderPrompt({ finding, pattern: patternInfo("try_then_claim"), answers: { abuse_cost: { value: "high" }, human_before: { value: "never" } }, doc: doc(), product: "Acme", url: "https://acme.dev/" });
    assert.match(body, /proof-of-work challenge; signup requires its solution\. No CAPTCHA/);
  });

  it("a person-first product gets a device flow instead of agent signup", () => {
    const body = renderPrompt({ finding, pattern: patternInfo("existing_account"), answers: { abuse_cost: { value: "low" }, human_before: { value: "always" } }, doc: doc(), product: "Acme", url: "https://acme.dev/" });
    assert.match(body, /RFC 8628/);
    assert.doesNotMatch(body, /POST \/v1\/agent\/signup/);
  });
});

describe("audit: brief and config", () => {
  it("the brief flags a model that lets an agent act before a required verified person", () => {
    const d = doc();
    const funnel = buildFunnel(d);
    const answers = answersFor(funnel, { onboarding: { value: "try_then_claim", source: "asked" }, human_before: { value: "always", source: "asked" } });
    const brief = renderBrief(buildAudit({ doc: d, funnel, answers, task: "t", runId: "r", version: "test" }), d);
    assert.match(brief, /Conflict: a verified person must exist before any use/);
    assert.match(brief, /payment, KYC and claim decisions by a real person were not tested/);
  });

  it("agent-ready.yml round-trips the answers", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-config-"));
    const path = join(dir, "agent-ready.yml");
    writeConfig(path, { url: "acme.dev", task: "Sign up", answers: { onboarding: { value: "agent_is_customer" }, abuse_cost: { value: "high" }, human_before: { value: "outbound" } } });
    assert.deepEqual(readConfig(path), { url: "acme.dev", task: "Sign up", onboarding: "agent_is_customer", abuse_cost: "high", human_before: "outbound" });
  });

  it("the verdict is a tally of working steps, not a walk that stops at the first gap", () => {
    const d = doc({ machineAccess: { aiCrawlersAllowed: verdict("yes"), hasAgentReadableIndex: verdict("no") } });
    const funnel = buildFunnel(d);
    const audit = buildAudit({ doc: d, funnel, answers: answersFor(funnel), task: "t", runId: "r", version: "test" });
    const working = audit.steps.filter((s) => ["agent_can", "handoff", "agent_did"].includes(s.state)).length;
    const [headline] = renderVerdict(audit, makeStyle(false));
    assert.equal(headline, `  Your public pages show ${working} of 7 steps working.`);
    assert.ok(working > 0, "a missing llms.txt does not zero the later steps");
  });

  it("the verdict says how many working steps rely on a person handing over access", () => {
    const d = doc({ onboarding: { patterns: [{ id: "existing_account", name: "Person sets up access first", status: "documented", needs: [], evidence: [{ obs: "obs_1" }] }] } });
    const funnel = buildFunnel(d);
    const audit = buildAudit({ doc: d, funnel, answers: answersFor(funnel), task: "t", runId: "r", version: "test" });
    const lines = renderVerdict(audit, makeStyle(false));
    assert.match(lines[1], /^  2 work because a person hands the agent access\./);
    for (const line of lines) assert.ok([...line].length <= 80, line);
  });

  it("every step row fits 80 columns", () => {
    const d = doc();
    const funnel = buildFunnel(d);
    const audit = buildAudit({ doc: d, funnel, answers: answersFor(funnel), task: "t", runId: "r", version: "test" });
    for (const line of renderSteps(audit, makeStyle(false))) assert.ok([...line].length <= 80, line);
  });

  it("parses bare domains, local hosts and IPs, and rejects what is not an address", () => {
    assert.equal(parseTarget("acme.dev"), "https://acme.dev/");
    assert.equal(parseTarget("http://127.0.0.1:8080/x"), "http://127.0.0.1:8080/x");
    assert.equal(parseTarget("localhost:3000"), "http://localhost:3000/");
    assert.equal(parseTarget("127.0.0.1:8080"), "http://127.0.0.1:8080/");
    assert.equal(parseTarget("https://localhost:3000"), "https://localhost:3000/");
    assert.equal(parseTarget("ht!tp://bad url"), null);
    assert.equal(parseTarget("acme"), null);
    assert.equal(parseTarget(""), null);
  });

  it("an answer that is not an option is asked again, not read as the default", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    // readline drops lines typed before it asks, so each reply goes in when its prompt appears.
    const replies = ["9", "3", "", ""];
    let written = "";
    output.on("data", (b) => {
      written += b;
      if (String(b).includes("Enter to keep, or a number: ") && replies.length) setImmediate(() => input.write(`${replies.shift()}\n`));
    });
    const defaults = { onboarding: { value: "try_then_claim", source: "recommended" }, abuse_cost: { value: "low", source: "default" }, human_before: { value: "never", source: "default" } };
    const answers = await askQuestions(defaults, { input, output, style: makeStyle(false) });
    assert.match(written, /Pick 1 to 6, or press Enter to keep the default\./);
    assert.deepEqual(answers.onboarding, { value: "agent_is_customer", source: "asked" });
    assert.deepEqual(answers.abuse_cost, defaults.abuse_cost);
  });

  it("names the product from its title without the tagline", () => {
    const named = (title, host) => productName({ product: { name: { value: title } }, target: { host } });
    assert.equal(named("Resend · Email for developers", "resend.com"), "Resend");
    assert.equal(named("Home \\ Anthropic", "anthropic.com"), "Anthropic");
    assert.equal(named("Acme API | Widgets", "acme.dev"), "Acme API");
    assert.equal(productName({ product: { name: null }, target: { host: "acme.dev" } }), "acme.dev");
  });

  it("the terminal, audit-report.json and the brief give the same score", () => {
    const d = doc({ machineAccess: { aiCrawlersAllowed: verdict("yes"), hasAgentReadableIndex: verdict("no") } });
    const funnel = buildFunnel(d);
    const audit = buildAudit({ doc: d, funnel, answers: answersFor(funnel), task: "t", runId: "r", version: "test" });
    const [line] = renderVerdict(audit, makeStyle(false));
    assert.equal(line.trim(), audit.headline);
    assert.ok(renderBrief(audit, d).includes(`**${audit.headline}**`));
  });

  it("wraps text at spaces within the width", () => {
    const lines = wrap("one two three four five six seven", 10);
    assert.ok(lines.every((l) => l.length <= 10));
    assert.equal(lines.join(" "), "one two three four five six seven");
  });
});

// The command end to end against a local product: no network, no questions.
const SITE = {
  "/": ["text/html", `<!doctype html><html><head><title>Acme API</title></head><body><a href="/docs">Docs</a> <a href="/pricing">Pricing</a></body></html>`],
  "/robots.txt": ["text/plain", "User-agent: *\nAllow: /\n"],
  "/pricing": ["text/html", "<html><body><h1>Pricing</h1><p>Pro $20/mo.</p></body></html>"],
  "/docs": ["text/html", "<html><body>Create an API key in the dashboard.</body></html>"],
};

function serve(table) {
  const server = createServer((req, res) => {
    const hit = table[req.url.split("?")[0]];
    if (!hit) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<html><body>404</body></html>");
    }
    res.writeHead(200, { "content-type": hit[0] });
    res.end(hit[1]);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

describe("audit: command", () => {
  let site;
  let child;
  before(async () => {
    // A separate process serves the site because spawnSync blocks this one.
    const script = `import { createServer } from "node:http"; const t = ${JSON.stringify(SITE)}; const s = createServer((q, r) => { const h = t[q.url.split("?")[0]]; if (!h) { r.writeHead(404, { "content-type": "text/html" }); return r.end("404"); } r.writeHead(200, { "content-type": h[0] }); r.end(h[1]); }); s.listen(0, "127.0.0.1", () => console.log(s.address().port));`;
    const { spawn } = await import("node:child_process");
    child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
    const port = await new Promise((r) => child.stdout.once("data", (b) => r(String(b).trim())));
    site = `http://127.0.0.1:${port}/`;
  });
  after(() => child.kill());

  it("without a terminal, answers or --yes, it exits 2 and says what to do", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const r = runCli(["audit", site], cwd);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /pass --yes for the defaults/);
  });

  it("with --yes --json it writes the audit, a brief and one prompt per finding", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const out = join(cwd, "run");
    const r = runCli(["audit", site, "--yes", "--json", "--out", out], cwd);
    assert.equal(r.status, 0, r.stderr);
    const audit = JSON.parse(r.stdout);
    assert.equal(audit.schema, "agent-ready/audit-report@1");
    assert.ok(existsSync(join(out, "audit-report.json")));
    assert.ok(!existsSync(join(out, "audit.json")), "audit.json belongs to the skill");
    assert.ok(audit.findings.length > 0);
    for (const f of audit.findings) assert.ok(existsSync(join(out, "prompts", f.file)), f.file);
    assert.ok(existsSync(join(out, "prompts", "ALL.md")));
    assert.match(readFileSync(join(out, "brief.md"), "utf8"), /## Decisions to confirm/);
    // With no agent-ready.yml yet, --yes writes the defaults so verify has a file to read.
    assert.equal(readConfig(join(cwd, "agent-ready.yml")).onboarding, audit.onboarding.chosen.id);
    assert.ok(readdirSync(out).includes("interface.json"));
  });

  it("--fail-on medium exits 1 when a medium fix exists, and a bad level exits 2", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    assert.equal(runCli(["audit", site, "--yes", "--json", "--fail-on", "medium", "--out", join(cwd, "a")], cwd).status, 1);
    assert.equal(runCli(["audit", site, "--yes", "--fail-on", "low"], cwd).status, 2);
  });

  it("a site that does not answer stops with exit 3 and writes nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const closed = await serve({});
    const dead = closed.base;
    closed.server.close();
    const r = runCli(["audit", dead, "--yes", "--out", join(cwd, "dead")], cwd);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /Could not reach .* Nothing was written\./s);
    assert.ok(!existsSync(join(cwd, "dead")));
  });

  it("a malformed address or a missing one is a usage error, exit 2, with an example", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const bad = runCli(["audit", "ht!tp://bad url", "--yes"], cwd);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /is not a web address\.\s+Try: agent-ready check example\.com/);
    const missing = runCli(["audit"], cwd);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Try: agent-ready check example\.com/);
  });

  it("--help shows example commands and exits 0", () => {
    const r = runCli(["audit", "--help"], mkdtempSync(join(tmpdir(), "audit-cli-")));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Examples:\n  agent-ready check example\.com /);
  });

  it("--yes never overwrites an agent-ready.yml that is already there", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const path = join(cwd, "agent-ready.yml");
    writeFileSync(path, "url: other.dev\ntask: Sign up\nonboarding: agent_is_customer\nverify_call: GET https://api.other.dev/v1/me\n");
    const before = readFileSync(path, "utf8");
    assert.equal(runCli(["audit", site, "--yes", "--json", "--out", join(cwd, "c")], cwd).status, 0);
    assert.equal(readFileSync(path, "utf8"), before);
  });

  it("an agent can answer every question with flags, with no terminal and no --yes", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const r = runCli(["audit", site, "--onboarding", "existing_account", "--abuse-cost", "high", "--human-before", "always", "--json", "--out", join(cwd, "f")], cwd);
    assert.equal(r.status, 0, r.stderr);
    const audit = JSON.parse(r.stdout);
    assert.deepEqual(audit.onboarding.chosen, { id: "existing_account", name: "Person sets up access first", source: "flag" });
    assert.equal(audit.answers.human_before.value, "always");
    // --json says where everything is, relative to where it ran.
    assert.ok(audit.files.prompts.every((p) => existsSync(join(cwd, p))), JSON.stringify(audit.files));
    assert.ok(existsSync(join(cwd, audit.files.brief)));
  });

  it("with --json every error is JSON on stdout with a code and a next step", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const cases = [
      [["audit", site, "--onboarding", "maybe", "--json"], "invalid_flag"],
      [["audit", "ht!tp://bad url", "--json", "--yes"], "invalid_address"],
      [["audit", site, "--json"], "answers_required"],
      [["audit", "--json"], "usage"],
      [["verify", "--json"], "config_missing"],
    ];
    for (const [args, code] of cases) {
      const r = runCli(args, cwd);
      assert.equal(r.status, 2, args.join(" "));
      const body = JSON.parse(r.stdout);
      assert.equal(body.schema, "agent-ready/error@1");
      assert.equal(body.error.code, code, args.join(" "));
      assert.ok(body.error.hint || body.error.message);
    }
  });

  it("reads answers from agent-ready.yml when it matches the host", () => {
    const cwd = mkdtempSync(join(tmpdir(), "audit-cli-"));
    writeConfig(join(cwd, "agent-ready.yml"), { url: new URL(site).host, task: "Sign up", answers: { onboarding: { value: "agent_is_customer" }, abuse_cost: { value: "high" }, human_before: { value: "never" } } });
    const r = runCli(["audit", site, "--json", "--out", join(cwd, "b")], cwd);
    assert.equal(r.status, 0, r.stderr);
    const audit = JSON.parse(r.stdout);
    assert.deepEqual(audit.onboarding.chosen, { id: "agent_is_customer", name: "Agent is the customer", source: "from agent-ready.yml" });
  });
});

describe("audit: inspect", () => {
  let site;
  before(async () => { site = await serve(SITE); });
  after(() => site.server.close());

  it("builds the interface and funnel from public pages only", async () => {
    const { doc: d, funnel } = await inspect({ url: site.base, version: "test", runId: "run_t" });
    assert.ok(d.observations.length > 0);
    assert.equal(funnel.steps.length, 7);
  });
});
