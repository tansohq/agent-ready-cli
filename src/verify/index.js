import { defineSignupTask } from "../harness/tasks/signup.js";
import { registrableDomain } from "../interface/sources.js";

// agent-ready verify: a real agent tries the task on the user's own product, and a separate checker decides.
// The checker is the call the user declared in agent-ready.yml, made three times: with the agent's key (must
// succeed and pass the assertion), with no key and with a wrong key (both must be refused). That catches an
// endpoint that answers anyone, without code written for each product.

const REFUSED = new Set([401, 403]);
export const KEY_ENV = "AGENT_READY_KEY";

// The verify_* lines of agent-ready.yml as a spec, or { error } naming what is missing.
export function parseVerifySpec(config) {
  const call = (config?.verify_call || "").trim();
  if (!call) return { error: "agent-ready.yml has no verify_call. Add the call that proves a key works, for example: verify_call: GET https://api.example.com/v1/me" };
  const match = /^(?:(GET)\s+)?(https?:\/\/\S+)$/i.exec(call);
  if (!match) return { error: `verify_call must be "GET <full URL>", not "${call}"` };
  const header = (config.verify_header || "Authorization: Bearer {key}").trim();
  const colon = header.indexOf(":");
  if (colon < 1 || !header.includes("{key}")) return { error: `verify_header must look like "Name: value with {key}", not "${header}"` };
  const expect = Number(config.verify_expect || 200);
  if (!Number.isInteger(expect) || expect < 200 || expect > 299) return { error: `verify_expect must be a 2xx status, not "${config.verify_expect}"` };
  const assertText = (config.verify_assert || "").trim();
  const eq = assertText.indexOf("=");
  const assert = !assertText ? null : eq === -1 ? { path: assertText, equals: null } : { path: assertText.slice(0, eq).trim(), equals: assertText.slice(eq + 1).trim() };
  return { method: "GET", url: match[2], header: { name: header.slice(0, colon).trim(), template: header.slice(colon + 1).trim() }, expect, assert };
}

export function describeSpec(spec) {
  const assertion = spec.assert ? (spec.assert.equals === null ? `, ${spec.assert.path} present` : `, ${spec.assert.path} = ${spec.assert.equals}`) : "";
  return `${spec.method} ${spec.url} with ${spec.header.name}: ${spec.header.template}; expect ${spec.expect}${assertion}`;
}

function readPath(json, path) {
  let value = json;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = value[part];
  }
  return value;
}

// A key that has the right shape but cannot be the real one.
function wrongKey(key) {
  return key.length > 8 ? `${key.slice(0, -4)}${key.slice(-4) === "xxxx" ? "yyyy" : "xxxx"}` : `${key}x`;
}

async function call(spec, key, fetchImpl) {
  const headers = key === null ? {} : { [spec.header.name]: spec.header.template.replace("{key}", key) };
  const res = await fetchImpl(spec.url, { method: spec.method, headers, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  let jsonError = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    // Kept, not dropped: an assertion against a body that is not JSON reports why it failed.
    jsonError = err.message;
  }
  return { status: res.status, json, jsonError, text };
}

// The three calls. checkerInvalid means the declared call proves nothing (it answers without a key), which is a
// problem with agent-ready.yml, not with the product or the agent.
export async function checkKey(spec, key, { fetchImpl = fetch } = {}) {
  const real = await call(spec, key, fetchImpl);
  const none = await call(spec, null, fetchImpl);
  const wrong = await call(spec, wrongKey(key), fetchImpl);
  const checks = [];
  let assertPass = true;
  let assertDetail = "";
  if (spec.assert) {
    const value = real.jsonError ? undefined : readPath(real.json, spec.assert.path);
    assertPass = spec.assert.equals === null ? value !== undefined && value !== null : String(value) === spec.assert.equals;
    assertDetail = real.jsonError ? `; body is not JSON (${real.jsonError})` : `; ${spec.assert.path} = ${value === undefined ? "missing" : JSON.stringify(value)}`;
  }
  checks.push({ id: "key_works", label: "Key works", pass: real.status === spec.expect && assertPass, detail: `${spec.method} ${spec.url} → ${real.status}${assertDetail}` });
  checks.push({ id: "no_key_refused", label: "No key refused", pass: REFUSED.has(none.status), detail: `without a key → ${none.status}` });
  checks.push({ id: "wrong_key_refused", label: "Wrong key refused", pass: REFUSED.has(wrong.status), detail: `with a wrong key → ${wrong.status}` });
  const checkerInvalid = !REFUSED.has(none.status) && none.status >= 200 && none.status < 300;
  const ok = checks.every((c) => c.pass);
  const detail = checks.map((c) => c.detail).join("; ");
  return { ok, status: real.status, detail, objects: { checks, checkerInvalid } };
}

// Hosts the agent may reach: the product's own site and the usual subdomains, plus the verify call's host.
export function networkFor(targetUrl, spec) {
  const host = new URL(targetUrl).hostname;
  const apex = registrableDomain(host);
  const hosts = [host, apex, ...["www", "api", "docs", "app", "auth", "console", "dashboard", "developers"].map((s) => `${s}.${apex}`), new URL(spec.url).hostname];
  return [...new Set(hosts)];
}

export function buildVerifyTask({ url, task, spec, fetchImpl = fetch }) {
  const host = new URL(url).hostname;
  return defineSignupTask({
    id: "verify",
    name: host,
    url,
    apiHost: new URL(spec.url).hostname,
    network: networkFor(url, spec),
    credentialEnvName: KEY_ENV,
    keyPattern: /^\S{8,}$/,
    taskText: `${task}. The product is ${host}.`,
    verify: { describe: describeSpec(spec), call: (key) => checkKey(spec, key, { fetchImpl }) },
  });
}

// Pass, handoff, fail or inconclusive, from the harness result. A handoff passes only when the chosen onboarding
// model says a person sets access up first: then stopping at that step is the agent doing the right thing.
const PERSON_FIRST = new Set(["existing_account", "agent_identity"]);
export function classify(result, onboarding) {
  const evaluation = result.evaluation || {};
  const stages = result.reconciled?.stages || [];
  if (evaluation.success) return { outcome: "passed", exitCode: 0, reason: "A real agent got its own key and the checker confirmed it works." };
  if (evaluation.objects?.checkerInvalid) return { outcome: "inconclusive", exitCode: 3, reason: "The verify call answers without a key, so it cannot prove the agent's key works. Pick a call that needs authentication." };
  if (stages.some((s) => s.agent?.outcome === "product_unavailable")) return { outcome: "inconclusive", exitCode: 3, reason: "The product returned server errors during the run. Try again later." };
  // Only a run that ended on its own (or used its whole turn budget) says anything about the product. A timeout,
  // a crash or a stopped process does not: the second real run was stopped after the agent already had a key.
  const stopped = result.execution?.stoppedBecause || "";
  if (!["success", "error_max_turns"].includes(stopped)) return { outcome: "inconclusive", exitCode: 3, reason: `The agent run did not finish (${stopped || "no result"}). This is not a result about the product.` };
  const unreachable = result.execution?.signals?.connectionFailures || 0;
  if (!evaluation.success && evaluation.stoppedAt !== "credential_rejected" && unreachable >= 2) return { outcome: "inconclusive", exitCode: 3, reason: `The agent could not connect to the product (${unreachable} connection failures). This is about the test environment, not the product.` };
  if (evaluation.stoppedAt === "human_required") {
    if (PERSON_FIRST.has(onboarding)) return { outcome: "handoff", exitCode: 0, reason: "The agent stopped where a person sets up access, which is what your onboarding model says." };
    return { outcome: "failed", exitCode: 1, reason: "The agent reached a step only a person can do." };
  }
  if (evaluation.stoppedAt === "credential_rejected") return { outcome: "failed", exitCode: 1, reason: "The agent got a key, but the checker's calls did not pass." };
  return { outcome: "failed", exitCode: 1, reason: "The agent did not get a key." };
}

// Which audit step a failure points at, so verify can write the same kind of fix prompt.
export function failedStep(result) {
  return result.evaluation?.stoppedAt === "credential_rejected" ? "access" : "signup";
}
