// The CLI's Tanso workspace: one key per API host, kept in the user's config directory. `verify` counts each run
// against the workspace's run allowance (6 starting runs, then 10 a day once a person claims the workspace). Nothing
// about the product being checked is sent: the signup carries a label, a run start carries nothing, a finish carries
// the outcome.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, chmodSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_API = "https://app.tansohq.com";
export const KEY_ENV = "AGENT_READY_API_KEY";
const TIMEOUT_MS = 15_000;

export function apiBase(env = process.env) {
  return (env.AGENT_READY_API_URL || DEFAULT_API).replace(/\/+$/, "");
}

export function credentialsPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "agent-ready", "credentials.json");
}

function readStore(path) {
  if (!existsSync(path)) return { hosts: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return { hosts: parsed.hosts || {} };
}

// Written to a temporary file and renamed, so an interrupted write never leaves half a file. The directory is 0700
// and the file 0600: the key spends the workspace's runs and the claim code adopts it.
function writeStore(path, store) {
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

// Where the key comes from, in order: the environment, then the saved file. Nothing here signs up.
export function resolveKey(env = process.env) {
  const host = new URL(apiBase(env)).host;
  if (env[KEY_ENV]) return { key: env[KEY_ENV], source: "env", host, saved: null };
  const saved = readStore(credentialsPath(env)).hosts[host] || null;
  return saved?.key ? { key: saved.key, source: "file", host, saved } : { key: null, source: null, host, saved: null };
}

export function saveCredentials(entry, env = process.env) {
  const path = credentialsPath(env);
  const store = readStore(path);
  store.hosts[new URL(apiBase(env)).host] = { ...entry, savedAt: new Date().toISOString() };
  writeStore(path, store);
  return path;
}

export function forgetCredentials(env = process.env) {
  const path = credentialsPath(env);
  const store = readStore(path);
  const host = new URL(apiBase(env)).host;
  if (!store.hosts[host]) return false;
  delete store.hosts[host];
  if (Object.keys(store.hosts).length) writeStore(path, store);
  else rmSync(path, { force: true });
  return true;
}

// A failed request is an AccountError: `unreachable` when the API could not be reached at all, otherwise the API's
// own error code and status, with its details (limit, window, resetsAt, claimed) kept for the caller to act on.
export class AccountError extends Error {
  constructor(code, message, { status = null, details = {} } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function call(env, method, path, { key = null, body = null } = {}) {
  const url = `${apiBase(env)}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new AccountError("unreachable", `Could not reach ${new URL(url).host} (${err.cause?.code || err.name}).`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new AccountError("bad_response", `${new URL(url).host} answered ${res.status} with something that is not JSON.`, { status: res.status }); }
  if (!res.ok) {
    // The API's errors are flat: { error: "run_limit_reached", message, limit, window, ... }.
    const { error: code = `http_${res.status}`, message = `${new URL(url).host} answered ${res.status}.`, ...details } = data || {};
    throw new AccountError(code, message, { status: res.status, details });
  }
  return data;
}

export function signup(version, env = process.env) {
  return call(env, "POST", "/v1/signup", { body: { label: `agent-ready CLI ${version}`, scopes: ["read", "run"] } });
}

export function startRun(key, env = process.env) {
  return call(env, "POST", "/v1/local-runs", { key, body: {} });
}

export function finishRun(key, id, outcome, env = process.env) {
  return call(env, "POST", `/v1/local-runs/${encodeURIComponent(id)}/finish`, { key, body: { outcome } });
}

export function account(key, env = process.env) {
  return call(env, "GET", "/v1/account", { key });
}

// "4 of 6 starting runs left", "7 of 10 runs left today", or null when the workspace has no limit.
export function describeUsage(usage) {
  if (!usage || !usage.limited) return null;
  return usage.window === "lifetime" ? `${usage.remaining} of ${usage.limit} starting runs left` : `${usage.remaining} of ${usage.limit} runs left today`;
}
