import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, BARE } from "./interface-fixtures.js";
import { pickVerifyCall } from "../src/verify/infer.js";
import { readConfig, writeConfig } from "../src/audit/config.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const SPEC_URL = "https://acme.dev/openapi.json";

// A product with an OpenAPI document whose only good check is GET /v1/me: the others are public, take a path
// parameter, or come after it in preference.
const BEARER_API = {
  openapi: "3.1.0",
  info: { title: "Acme" },
  servers: [{ url: "/" }],
  security: [{ bearer: [] }],
  components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
  paths: {
    "/health": { get: { security: [], responses: { 200: {} } } },
    "/v1/widgets": { get: { responses: { 200: {} } }, post: { responses: { 201: {} } } },
    "/v1/users/{id}": { get: { responses: { 200: {} } } },
    "/v1/me": { get: { summary: "The caller's account", responses: { 200: {} } } },
  },
};

const PRODUCT = {
  "/": ["text/html", '<html><head><title>Acme</title></head><body><a href="/docs">Docs</a></body></html>'],
  "/docs": ["text/html", "<html><body>The API is described at /openapi.json. Send your API key as a bearer token.</body></html>"],
  "/openapi.json": ["application/json", JSON.stringify(BEARER_API)],
  // Only reachable through a saved interface.json: no page links it and it is not at a well-known path.
  "/internal/spec.json": ["application/json", JSON.stringify({ ...BEARER_API, paths: { "/v2/whoami": { get: { responses: { 200: {} } } } } })],
};

const ANSWERS = { onboarding: { value: "try_then_claim" }, abuse_cost: { value: "low" }, human_before: { value: "never" } };

// A stand-in claude on PATH, signed in, so --check never depends on this machine.
function fakeClaudeEnv() {
  const bin = mkdtempSync(join(tmpdir(), "fake-claude-"));
  writeFileSync(join(bin, "claude"), `#!/usr/bin/env node\nif (process.argv[2] === "--version") console.log("9.9.9 (Claude Code)");\nelse console.log(JSON.stringify({ loggedIn: true }));\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const env = { ...process.env, NO_COLOR: "1", PATH: `${bin}:${process.env.PATH}` };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

// spawnSync would block this process's event loop, and with it the fixture server the CLI is reading.
function runCli(args, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function projectFor(base) {
  const cwd = mkdtempSync(join(tmpdir(), "verify-infer-"));
  writeConfig(join(cwd, "agent-ready.yml"), { url: new URL(base).host, task: "Sign up", answers: ANSWERS });
  return cwd;
}

describe("test: infers the verify call from the product's OpenAPI document", () => {
  it("picks GET /v1/me with a bearer token, on servers[0]", () => {
    const picked = pickVerifyCall(BEARER_API, SPEC_URL);
    assert.equal(picked.call, "GET https://acme.dev/v1/me");
    assert.equal(picked.header, "Authorization: Bearer {key}");
    assert.equal(picked.headerName, "Authorization");
  });

  it("uses an API key header scheme's own header name, and an absolute server with its variable defaults", () => {
    const doc = {
      openapi: "3.0.3",
      servers: [{ url: "https://{region}.api.acme.dev/v2", variables: { region: { default: "us" } } }],
      components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Api-Key" }, query: { type: "apiKey", in: "query", name: "key" } } },
      paths: {
        "/projects": { get: { security: [{ query: [] }] } },
        "/account": { get: { security: [{ key: [] }] } },
      },
    };
    const picked = pickVerifyCall(doc, SPEC_URL);
    assert.equal(picked.call, "GET https://us.api.acme.dev/v2/account");
    assert.equal(picked.header, "X-Api-Key: {key}");
  });

  it("skips operations with required path parameters, even preferred ones", () => {
    const doc = {
      openapi: "3.1.0",
      security: [{ bearer: [] }],
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } }, parameters: { Org: { name: "org", in: "query", required: true } } },
      paths: {
        "/v1/accounts/{account_id}/me": { get: {} },
        "/v1/orgs/me": { get: { parameters: [{ $ref: "#/components/parameters/Org" }] } },
        "/v1/projects": { get: {} },
      },
    };
    assert.equal(pickVerifyCall(doc, SPEC_URL).call, "GET https://acme.dev/v1/projects");
  });

  it("finds nothing when every GET is public or needs a parameter", () => {
    const doc = { openapi: "3.1.0", paths: { "/v1/items": { get: {} }, "/v1/items/{id}": { get: { security: [{ bearer: [] }] } } }, components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } } };
    assert.match(pickVerifyCall(doc, SPEC_URL).error, /no GET that needs a key/);
  });
});

describe("test: the inferred call on the command line", () => {
  let product;
  let bare;
  let env;
  before(async () => {
    product = await serve(PRODUCT);
    bare = await serve(BARE);
    env = fakeClaudeEnv();
  });
  after(() => {
    product.server.close();
    bare.server.close();
  });

  it("--check --json --yes plans with the inferred call, marks it inferred, and saves it keeping the other lines", async () => {
    const cwd = projectFor(product.base);
    const before = readFileSync(join(cwd, "agent-ready.yml"), "utf8");
    const r = await runCli(["test", "--check", "--json", "--yes"], cwd, env);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.schema, "agent-ready/verify-plan@1");
    assert.equal(plan.checker.inferred, true);
    assert.equal(plan.checker.inferredFrom, `${product.base}openapi.json`);
    assert.match(plan.checker.call, new RegExp(`^GET ${product.base}v1/me with Authorization: Bearer \\{key\\}`));
    const after = readFileSync(join(cwd, "agent-ready.yml"), "utf8");
    assert.equal(readConfig(join(cwd, "agent-ready.yml")).verify_call, `GET ${product.base}v1/me`);
    assert.equal(readConfig(join(cwd, "agent-ready.yml")).verify_header, "Authorization: Bearer {key}");
    const kept = before.split("\n").filter((l) => !/^#\s*verify_(call|header):/.test(l));
    for (const line of kept) assert.ok(after.split("\n").includes(line), line);
  });

  it("without --yes and without a terminal, uses the inferred call for the plan but does not save it", async () => {
    const cwd = projectFor(product.base);
    const r = await runCli(["test", "--check"], cwd, env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`Will check with GET ${product.base}v1/me \\(Authorization\\)`));
    assert.match(r.stderr, /Not saved to agent-ready\.yml/);
    assert.equal(readConfig(join(cwd, "agent-ready.yml")).verify_call, undefined);
  });

  it("reuses the latest interface.json from check instead of inspecting again", async () => {
    const cwd = projectFor(product.base);
    const run = join(cwd, ".agent-ready", new URL(product.base).host, "2026-10-06T00-00-00-abcdef");
    mkdirSync(run, { recursive: true });
    const doc = { observations: [{ id: "obs_1", role: "openapi", url: `${product.base}internal/spec.json`, ok: true, status: 200 }], interfaces: { api: { machineReadableSpec: { verdict: "yes", basedOn: ["obs_1"] } } } };
    writeFileSync(join(run, "interface.json"), JSON.stringify(doc));
    const r = await runCli(["test", "--check", "--json"], cwd, env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.parse(r.stdout).checker.call, new RegExp(`^GET ${product.base}v2/whoami`));
  });

  it("a declared verify_call is used as it is, not inferred", () => {
    const cwd = mkdtempSync(join(tmpdir(), "verify-infer-"));
    writeFileSync(join(cwd, "agent-ready.yml"), "url: acme.dev\ntask: Sign up\nverify_call: GET https://api.acme.dev/v1/me\n");
    const r = spawnSync(process.execPath, [CLI, "test", "--check", "--json"], { cwd, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).checker.inferred, false);
  });

  it("with no OpenAPI document to take a call from, exits 2 and says to add verify_call", async () => {
    const cwd = projectFor(bare.base);
    const r = await runCli(["test", "--check", "--json", "--yes"], cwd, env);
    assert.equal(r.status, 2, r.stderr);
    const error = JSON.parse(r.stdout).error;
    assert.equal(error.code, "verify_call_invalid");
    assert.match(error.message, /no verify_call, and none could be taken from the product's docs/);
    assert.match(r.stderr, /verify_call: GET https:\/\/api\.example\.com\/v1\/me/);
    assert.equal(readConfig(join(cwd, "agent-ready.yml")).verify_call, undefined);
  });
});
