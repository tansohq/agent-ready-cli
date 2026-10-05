import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerifySpec, checkKey, buildVerifyTask, classify, networkFor, KEY_ENV } from "../src/verify/index.js";
import { renderVerify } from "../src/verify/render.js";
import { makeStyle } from "../src/audit/render.js";
import { runHarness } from "../src/harness/index.js";
import { EXECUTORS } from "../src/harness/execute.js";
import { secretsInText } from "../src/harness/secrets.js";
import { chmodSync, mkdirSync } from "node:fs";
import { argsFor, settingsFor, run as runClaudePrint } from "../src/harness/executors/claude-print.js";
import { readConfig, writeConfig } from "../src/audit/config.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const GOOD = "ar_live_goodkey_123456";

// A product whose /v1/me answers only the good key, and an open endpoint that answers anyone.
function serve() {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><head><title>Acme</title></head><body>Acme API</body></html>");
    }
    if (req.url === "/v1/me") {
      if (auth === `Bearer ${GOOD}`) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "acct_1", anonymous: false }));
      }
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (req.url === "/v1/open") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "anyone" }));
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// Stands in for Claude Code: writes what an agent would leave in its scratch directory.
function fakeAgent(files) {
  return {
    name: "fake-verify",
    run: async ({ workDir }) => {
      for (const [name, body] of Object.entries(files)) writeFileSync(join(workDir, name), body);
      const now = new Date().toISOString();
      return { executor: { name: "fake-verify" }, startedAt: now, finishedAt: now, exitCode: 0, stoppedBecause: "success", turns: 4, costUsd: 0.5, stderr: null, rawTrace: null };
    },
  };
}

const PLAN = "Use the REST API. Signup docs: https://acme.dev/docs/agents\n";

describe("verify: the declared call", () => {
  it("needs a GET with a full URL, a header with {key}, a 2xx expectation", () => {
    assert.match(parseVerifySpec({}).error, /no verify_call/);
    assert.match(parseVerifySpec({ verify_call: "POST https://x.dev/v1/me" }).error, /must be "GET <full URL>"/);
    assert.match(parseVerifySpec({ verify_call: "GET https://x.dev/v1/me", verify_header: "X-Key" }).error, /verify_header must look like/);
    assert.match(parseVerifySpec({ verify_call: "GET https://x.dev/v1/me", verify_expect: "401" }).error, /2xx/);
    const spec = parseVerifySpec({ verify_call: "https://x.dev/v1/me", verify_assert: "anonymous=false" });
    assert.deepEqual(spec.header, { name: "Authorization", template: "Bearer {key}" });
    assert.deepEqual(spec.assert, { path: "anonymous", equals: "false" });
    assert.equal(spec.expect, 200);
  });

  it("lets the agent reach the product, its usual subdomains and the API host", () => {
    const hosts = networkFor("https://acme.dev/", { url: "https://api.acme-cloud.com/v1/me" });
    for (const h of ["acme.dev", "api.acme.dev", "docs.acme.dev", "api.acme-cloud.com"]) assert.ok(hosts.includes(h), h);
  });
});

describe("verify: the checker", () => {
  let site;
  before(async () => { site = await serve(); });
  after(() => site.server.close());

  it("passes only when the key works and no key and a wrong key are both refused", async () => {
    const spec = parseVerifySpec({ verify_call: `GET ${site.base}/v1/me`, verify_assert: "anonymous=false" });
    const good = await checkKey(spec, GOOD);
    assert.equal(good.ok, true, good.detail);
    assert.deepEqual(good.objects.checks.map((c) => c.pass), [true, true, true]);
    const bad = await checkKey(spec, "ar_live_notthekey_99999");
    assert.equal(bad.ok, false);
    assert.equal(bad.objects.checks[0].pass, false);
  });

  it("an agent that could not connect at all is inconclusive, not a failure of the product", () => {
    const result = { evaluation: { success: false, stoppedAt: "not_acquired" }, execution: { stoppedBecause: "success", signals: { connectionFailures: 3 } } };
    const verdict = classify(result, "try_then_claim");
    assert.equal(verdict.outcome, "inconclusive");
    assert.match(verdict.reason, /could not connect/);
  });

  it("an endpoint that answers without a key proves nothing, and says so", async () => {
    const spec = parseVerifySpec({ verify_call: `GET ${site.base}/v1/open` });
    const r = await checkKey(spec, GOOD);
    assert.equal(r.ok, false);
    assert.equal(r.objects.checkerInvalid, true);
    assert.equal(classify({ evaluation: { success: false, objects: r.objects } }, "try_then_claim").exitCode, 3);
  });
});

describe("verify: a run end to end with a stand-in agent", () => {
  let site;
  before(async () => { site = await serve(); });
  after(() => {
    site.server.close();
    delete EXECUTORS["fake-verify"];
  });

  async function run(files, onboarding = "try_then_claim") {
    EXECUTORS["fake-verify"] = fakeAgent(files);
    const spec = parseVerifySpec({ verify_call: `GET ${site.base}/v1/me`, verify_assert: "id" });
    const out = mkdtempSync(join(tmpdir(), "verify-run-"));
    const result = await runHarness({ taskModule: buildVerifyTask({ url: `${site.base}/`, task: "Sign up and make one read", spec }), runId: "run_v", outDir: out, version: "test", mode: "signup", noInbox: true, executorName: "fake-verify", maxTurns: 5 });
    return { result, verdict: classify(result, onboarding), out };
  }

  it("a key the agent wrote that passes all three calls is a pass, and the key is scrubbed from disk", async () => {
    const { verdict, out } = await run({ "PLAN.md": PLAN, "CREDENTIAL.env": `${KEY_ENV}=${GOOD}\n`, "RESULT.md": "GET /v1/me 200\n" });
    assert.equal(verdict.outcome, "passed", verdict.reason);
    assert.doesNotMatch(readFileSync(join(out, "work", "CREDENTIAL.env"), "utf8"), new RegExp(GOOD));
  });

  it("a key the API rejects is a fail pointing at access", async () => {
    const { verdict } = await run({ "PLAN.md": PLAN, "CREDENTIAL.env": `${KEY_ENV}=ar_live_madeup_000000\n` });
    assert.equal(verdict.outcome, "failed");
    assert.match(verdict.reason, /checker's calls did not pass/);
  });

  it("stopping at a human step fails, unless the onboarding model says a person sets access up first", async () => {
    const files = { "PLAN.md": PLAN, "NEEDS_HUMAN.md": "# Needs a human\nCAPTCHA at https://acme.dev/signup\n" };
    assert.equal((await run(files, "try_then_claim")).verdict.outcome, "failed");
    assert.equal((await run(files, "existing_account")).verdict.outcome, "handoff");
  });
});

describe("verify: what the agent inherits and what stays on disk", () => {
  let site;
  before(async () => { site = await serve(); });
  after(() => {
    site.server.close();
  });

  it("the agent runs without the operator's MCP servers, hooks, plugins or CLAUDE.md", () => {
    const args = argsFor({ prompt: "p", maxTurns: 5, settingsPath: "/tmp/s.json", tools: ["Bash"] });
    assert.ok(args.includes("--strict-mcp-config"));
    assert.equal(args[args.indexOf("--setting-sources") + 1], "project,local");
  });

  it("opens localhost to the agent only when the product itself is local", () => {
    assert.equal(settingsFor({ network: ["acme.dev", "api.acme.dev"], tools: ["Bash"] }).sandbox.network.allowLocalBinding, undefined);
    assert.equal(settingsFor({ network: networkFor("http://localhost:4321/", { url: "http://localhost:4321/v1/me" }), tools: ["Bash"] }).sandbox.network.allowLocalBinding, true);
  });

  it("finds one-time tokens in links, not short page numbers", () => {
    assert.deepEqual(secretsInText("Sign in: https://portal.telnyx.com/#/login?portal_redirect_token=01a10ce9-306e-7bd8&next=1"), ["01a10ce9-306e-7bd8"]);
    assert.deepEqual(secretsInText("https://example.com/docs?page=2&code=abc"), []);
  });

  it("scrubs sign-in links from the emails in inbox/ after the run", async () => {
    const link = "https://portal.example.dev/login?token=onetime0123456789abcdef";
    EXECUTORS["fake-mail"] = {
      name: "fake-mail",
      run: async ({ workDir }) => {
        writeFileSync(join(workDir, "PLAN.md"), PLAN);
        writeFileSync(join(workDir, "inbox", "0001.json"), JSON.stringify({ from: "noreply@example.dev", subject: "Sign in", text: `Click ${link}` }));
        const now = new Date().toISOString();
        return { executor: { name: "fake-mail" }, startedAt: now, finishedAt: now, exitCode: 0, stoppedBecause: "success", turns: 2, costUsd: 0.01, stderr: null, rawTrace: null };
      },
    };
    try {
      const spec = parseVerifySpec({ verify_call: `GET ${site.base}/v1/me` });
      const out = mkdtempSync(join(tmpdir(), "verify-mail-"));
      await runHarness({ taskModule: buildVerifyTask({ url: `${site.base}/`, task: "Sign up", spec }), runId: "run_m", outDir: out, version: "test", mode: "signup", noInbox: true, executorName: "fake-mail", maxTurns: 2 });
      const mail = readFileSync(join(out, "work", "inbox", "0001.json"), "utf8");
      assert.doesNotMatch(mail, /onetime0123456789abcdef/);
      assert.match(mail, /noreply@example\.dev/);
    } finally {
      delete EXECUTORS["fake-mail"];
    }
  });

  it("finds secrets a product returned, by field name, in plain or escaped JSON", () => {
    assert.deepEqual(secretsInText('{"key":"ark_ws1_s3cretvalue","claimCode":"clm_ws1_alsosecret","claimed":false}').sort(), ["ark_ws1_s3cretvalue", "clm_ws1_alsosecret"]);
    assert.deepEqual(secretsInText(String.raw`{"content":"{\n  \"key\": \"ark_ws1_s3cretvalue\"}"}`), ["ark_ws1_s3cretvalue"]);
  });

  // The real executor, with a stand-in claude binary on PATH. The signup body sits after long headers, as curl -i
  // printed it in the second real run, so it falls past the 400 characters the event log keeps.
  it("scrubs a key and claim code from the raw trace even when the agent never wrote CREDENTIAL.env", async () => {
    const bin = mkdtempSync(join(tmpdir(), "fake-claude-"));
    const body = '{"workspace":"ws9","key":"ark_ws9_fullsecretkey123","claimCode":"clm_ws9_fullclaimcode456"}';
    const headers = Array.from({ length: 20 }, (_, i) => `x-header-${i}: ${"v".repeat(30)}`).join("\r\n");
    const lines = [
      { type: "system", subtype: "init", mcp_servers: [] },
      { type: "user", message: { content: [{ type: "tool_result", content: `HTTP/2 201\r\n${headers}\r\n\r\n${body}` }] } },
    ];
    const script = `#!/usr/bin/env node\nfor (const l of ${JSON.stringify(lines.map((l) => JSON.stringify(l)))}) console.log(l);\nprocess.exit(143);\n`;
    writeFileSync(join(bin, "claude"), script);
    chmodSync(join(bin, "claude"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const spec = parseVerifySpec({ verify_call: `GET ${site.base}/v1/me` });
      const out = mkdtempSync(join(tmpdir(), "verify-leak-"));
      const result = await runHarness({ taskModule: buildVerifyTask({ url: `${site.base}/`, task: "Sign up", spec }), runId: "run_l", outDir: out, version: "test", mode: "signup", noInbox: true, executorName: "claude-print", maxTurns: 5 });
      for (const file of ["trace.jsonl", "execution.json"]) assert.doesNotMatch(readFileSync(join(out, "work", file), "utf8"), /fullsecretkey123|fullclaimcode456/, file);
      // Stopped mid-run: not a result about the product.
      assert.equal(classify(result, "try_then_claim").outcome, "inconclusive");
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("verify: an agent that goes silent", () => {
  it("is stopped after the idle window and reported as stalled, not left to the 30-minute limit", async () => {
    const bin = mkdtempSync(join(tmpdir(), "fake-claude-"));
    writeFileSync(join(bin, "claude"), `#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: "system", subtype: "init" }));\nsetTimeout(() => {}, 60000);\n`);
    chmodSync(join(bin, "claude"), 0o755);
    const workDir = mkdtempSync(join(tmpdir(), "stall-"));
    const started = Date.now();
    const r = await runClaudePrint({ prompt: "p", workDir, childEnv: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, tools: ["Bash"], network: ["acme.dev"], maxTurns: 2, redact: (t) => t, onEvent: () => {}, idleMs: 500 });
    assert.equal(r.stoppedBecause, "stalled");
    assert.ok(Date.now() - started < 10000);
    assert.equal(classify({ evaluation: {}, execution: { stoppedBecause: r.stoppedBecause } }, "try_then_claim").outcome, "inconclusive");
  });
});

describe("verify: output", () => {
  it("every line fits 80 columns, even with a long check URL", () => {
    const long = "GET https://api.some-very-long-product-name.example.com/v1/organizations/current/members/me → 200; id = \"acct_123\"";
    const result = { evaluation: { checks: [{ id: "credential_acquired", pass: true }], objects: { checks: [{ label: "Key works", pass: true, detail: long }, { label: "No key refused", pass: true, detail: "without a key → 401" }] } }, execution: { turns: 9, costUsd: 0.2 } };
    const lines = renderVerify({ host: "example.com", task: "Sign up", result, verdict: { outcome: "passed", reason: "ok" }, folder: ".agent-ready/x", promptFile: null }, makeStyle(false));
    for (const line of lines) assert.ok([...line].length <= 80, line);
    assert.ok(lines.some((l) => l.includes("members/me")));
  });
});

describe("verify: command", () => {
  const runCli = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

  it("without agent-ready.yml it exits 2 and says to run audit first", () => {
    const r = runCli(["verify"], mkdtempSync(join(tmpdir(), "verify-cli-")));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Run "agent-ready audit <url> --yes" first/);
  });

  it("without a verify_call it exits 2 with an example", () => {
    const cwd = mkdtempSync(join(tmpdir(), "verify-cli-"));
    writeConfig(join(cwd, "agent-ready.yml"), { url: "acme.dev", task: "Sign up", answers: { onboarding: { value: "try_then_claim" }, abuse_cost: { value: "low" }, human_before: { value: "never" } } });
    const r = runCli(["verify"], cwd);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /verify_call: GET https:\/\/api\.example\.com\/v1\/me/);
  });

  it("without Claude Code installed it says how to install it, exit 2", () => {
    const cwd = mkdtempSync(join(tmpdir(), "verify-cli-"));
    writeFileSync(join(cwd, "agent-ready.yml"), "url: acme.dev\ntask: Sign up\nonboarding: try_then_claim\nverify_call: GET https://api.acme.dev/v1/me\n");
    const r = spawnSync(process.execPath, [CLI, "verify", "--yes"], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", PATH: dirname(process.execPath) } });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /claude command was not found/);
  });

  it("without a terminal it will not start an agent unless --yes is passed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "verify-cli-"));
    writeFileSync(join(cwd, "agent-ready.yml"), "url: acme.dev\ntask: Sign up\nonboarding: try_then_claim\nverify_call: GET https://api.acme.dev/v1/me\n");
    const r = runCli(["verify"], cwd);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Pass --yes/);
  });

  it("re-answering the audit questions keeps the verify lines the user filled in", () => {
    const cwd = mkdtempSync(join(tmpdir(), "verify-cli-"));
    const path = join(cwd, "agent-ready.yml");
    writeFileSync(path, "url: acme.dev\ntask: Sign up\nonboarding: try_then_claim\nverify_call: GET https://api.acme.dev/v1/me\nverify_assert: id\n");
    writeConfig(path, { url: "acme.dev", task: "Sign up", answers: { onboarding: { value: "agent_is_customer" }, abuse_cost: { value: "low" }, human_before: { value: "never" } } });
    const config = readConfig(path);
    assert.equal(config.onboarding, "agent_is_customer");
    assert.equal(config.verify_call, "GET https://api.acme.dev/v1/me");
    assert.equal(config.verify_assert, "id");
  });
});
