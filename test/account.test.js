import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKey, saveCredentials, forgetCredentials, credentialsPath, startRun, describeUsage, AccountError } from "../src/account/index.js";

const envWith = (extra = {}) => ({ XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "acct-")), AGENT_READY_API_URL: "https://api.example.test", ...extra });

test("the key comes from the environment first, then the saved file, one entry per API host", () => {
  const env = envWith();
  assert.equal(resolveKey(env).key, null);
  saveCredentials({ key: "ark_ws_saved", claimCode: "clm_ws_x" }, env);
  assert.equal(statSync(credentialsPath(env)).mode & 0o777, 0o600);
  assert.deepEqual([resolveKey(env).key, resolveKey(env).source], ["ark_ws_saved", "file"]);
  assert.equal(resolveKey({ ...env, AGENT_READY_API_KEY: "ark_ws_env" }).key, "ark_ws_env");
  assert.equal(resolveKey({ ...env, AGENT_READY_API_URL: "https://other.example.test" }).key, null, "another host has its own entry");
  assert.equal(forgetCredentials(env), true);
  assert.equal(existsSync(credentialsPath(env)), false);
});

test("an API refusal keeps its code and details, and an unreachable API says so", async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "run_limit_reached", message: "Used.", limit: 6, window: "lifetime", resetsAt: null, claimed: false }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  await assert.rejects(startRun("ark_ws_k", envWith({ AGENT_READY_API_URL: `http://127.0.0.1:${server.address().port}` })), (err) => err instanceof AccountError && err.code === "run_limit_reached" && err.details.window === "lifetime" && err.details.limit === 6);
  await assert.rejects(startRun("ark_ws_k", envWith({ AGENT_READY_API_URL: "http://127.0.0.1:9" })), (err) => err.code === "unreachable");
});

test("usage reads as runs left", () => {
  assert.equal(describeUsage({ limited: true, remaining: 4, limit: 6, window: "lifetime" }), "4 of 6 starting runs left");
  assert.equal(describeUsage({ limited: true, remaining: 7, limit: 10, window: "day" }), "7 of 10 runs left today");
  assert.equal(describeUsage({ limited: false }), null);
});
