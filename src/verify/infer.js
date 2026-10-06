import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "../probe/http.js";
import { buildInterface } from "../interface/index.js";
import { OUT_DIR } from "../history/index.js";

// agent-ready.yml without a verify_call: take the call from the product's own OpenAPI document. The pick is a GET
// that needs a key (a bearer token or an API key header) and has no required parameters, on servers[0],
// preferring a path that reads the caller's own account.
const PREFERRED = /\/(?:me|whoami|account|user|viewer)\/?$/i;

// A local "#/components/..." reference, followed; anything else is returned as it is.
function resolveRef(openapi, node) {
  if (!node || typeof node.$ref !== "string") return node;
  if (!node.$ref.startsWith("#/")) return null;
  let value = openapi;
  for (const part of node.$ref.slice(2).split("/")) {
    if (value === null || typeof value !== "object") return null;
    value = value[part];
  }
  return value ?? null;
}

// The header a key goes in, from the operation's security requirement, or null when the operation can be called
// without a key (an empty requirement) or only with a scheme the checker cannot send.
function headerFor(openapi, security) {
  if (!Array.isArray(security) || !security.length) return null;
  if (security.some((s) => !s || typeof s !== "object" || !Object.keys(s).length)) return null;
  const schemes = openapi.components?.securitySchemes || {};
  for (const requirement of security) {
    const names = Object.keys(requirement);
    if (names.length !== 1) continue;
    const scheme = resolveRef(openapi, schemes[names[0]]);
    if (!scheme) continue;
    if (scheme.type === "http" && String(scheme.scheme || "").toLowerCase() === "bearer") return { name: "Authorization", template: "Bearer {key}" };
    if (scheme.type === "apiKey" && scheme.in === "header" && typeof scheme.name === "string" && scheme.name) return { name: scheme.name, template: "{key}" };
  }
  return null;
}

// servers[0] as an absolute URL, with its variables at their defaults. No servers means "/", as OpenAPI says.
function serverUrl(openapi, specUrl) {
  const server = Array.isArray(openapi.servers) ? openapi.servers[0] : null;
  const text = String(server?.url || "/").replace(/\{([^}]+)\}/g, (whole, name) => server?.variables?.[name]?.default ?? whole);
  if (text.includes("{")) return null;
  return new URL(text, specUrl).toString().replace(/\/$/, "");
}

export function pickVerifyCall(openapi, specUrl) {
  if (!openapi || typeof openapi !== "object" || !openapi.openapi) return { error: `${specUrl} is not an OpenAPI 3 document` };
  const base = serverUrl(openapi, specUrl);
  if (!base) return { error: `the first server URL in ${specUrl} has a variable with no default` };
  const candidates = [];
  for (const [path, item] of Object.entries(openapi.paths || {})) {
    const op = item?.get;
    if (!op || typeof op !== "object") continue;
    // Path parameters are always required, and the checker has no value to fill in.
    if (path.includes("{")) continue;
    const params = [...(item.parameters || []), ...(op.parameters || [])].map((p) => resolveRef(openapi, p));
    if (params.some((p) => !p || p.required)) continue;
    const header = headerFor(openapi, Object.hasOwn(op, "security") ? op.security : openapi.security);
    if (!header) continue;
    candidates.push({ path, header });
  }
  if (!candidates.length) return { error: `${specUrl} has no GET that needs a key (a bearer token or an API key header) and takes no required parameters` };
  candidates.sort((a, b) => Number(!PREFERRED.test(a.path)) - Number(!PREFERRED.test(b.path)) || a.path.length - b.path.length);
  const { path, header } = candidates[0];
  const url = `${base}${path}`;
  return { method: "GET", url, call: `GET ${url}`, header: `${header.name}: ${header.template}`, headerName: header.name };
}

// The newest interface.json that `check` wrote for this host, or null.
export function latestInterface(cwd, url) {
  const dir = join(cwd, OUT_DIR, new URL(url).host);
  if (!existsSync(dir)) return null;
  for (const run of readdirSync(dir).sort().reverse()) {
    const path = join(dir, run, "interface.json");
    if (existsSync(path)) return { path, doc: JSON.parse(readFileSync(path, "utf8")) };
  }
  return null;
}

// The saved inspection when there is one, else the same public inspection `check` runs, then the OpenAPI document
// it found, fetched again in full because interface.json keeps only an excerpt. GET only.
export async function inferVerifyCall({ url, version, cwd, log = () => {} }) {
  const saved = latestInterface(cwd, url);
  const doc = saved ? saved.doc : await buildInterface({ url, version, log });
  const spec = doc.interfaces?.api?.machineReadableSpec;
  const obs = spec?.verdict === "yes" ? (doc.observations || []).find((o) => o.id === spec.basedOn?.[0]) : null;
  if (!obs) return { error: "the product's public pages have no OpenAPI document in JSON to take one from", interfaceFile: saved?.path || null };
  const res = await get(obs.url);
  if (!res.ok || res.status < 200 || res.status > 299) return { error: `its OpenAPI document at ${obs.url} answered ${res.status || res.error}`, interfaceFile: saved?.path || null };
  let openapi;
  try {
    openapi = JSON.parse(res.text);
  } catch (err) {
    return { error: `its OpenAPI document at ${obs.url} is not valid JSON (${err.message})`, interfaceFile: saved?.path || null };
  }
  return { ...pickVerifyCall(openapi, obs.url), specUrl: obs.url, interfaceFile: saved?.path || null };
}
