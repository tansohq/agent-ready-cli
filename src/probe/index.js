import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { get, isHtml, parseJson, joinUrl, excerpt } from "./http.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_SCHEMA = JSON.parse(readFileSync(join(__dirname, "pricing.schema.json"), "utf8"));

export const AI_BOTS = ["GPTBot", "ClaudeBot", "ChatGPT-User", "PerplexityBot", "Claude-Web", "anthropic-ai", "CCBot", "Google-Extended", "OAI-SearchBot"];
const CAPTCHA_RE = /recaptcha|hcaptcha|turnstile|cf-challenge|arkoselabs|funcaptcha|geetest/i;
const SIGNUP_PATHS = ["/signup", "/sign-up", "/register", "/auth/signup", "/auth/register", "/get-started"];
const SIGNUP_API_RE = /\/(v\d+\/)?(accounts|signup|sign-up|register|registrations|agent-signup|catalog\/[^/]+\/signup)\/?$/i;
const PURCHASE_API_RE = /(subscriptions|purchases|checkout|credits|billing|plans|orders)/i;

function result(id, status, detail, extra = {}) {
  return { id, status, detail, ...extra };
}

function http(res, method = "GET") {
  return { method, status: res.status };
}

export async function robotsAi(base) {
  const url = joinUrl(base, "/robots.txt");
  const res = await get(url);
  if (!res.ok || res.status >= 400) return result("robots_ai", "warn", `robots.txt ${res.status || res.error}: no rules, crawlers assume allowed`, { url, http: http(res), data: { allowed: true } });
  const groups = parseRobots(res.text);
  const star = groups.get("*");
  const blockedAll = (g) => g && g.disallow.some((p) => p === "/") && !g.allow.some((p) => p === "/");
  const explicit = AI_BOTS.filter((b) => groups.has(b.toLowerCase()));
  const blockedBots = AI_BOTS.filter((b) => blockedAll(groups.get(b.toLowerCase())));
  if (blockedBots.length >= 3 || (blockedAll(star) && explicit.length === 0)) return result("robots_ai", "fail", `robots.txt blocks AI agents: ${blockedBots.length ? blockedBots.join(", ") : "User-agent: * Disallow: /"}`, { url, http: http(res) });
  if (blockedBots.length) return result("robots_ai", "warn", `robots.txt blocks ${blockedBots.join(", ")}`, { url, http: http(res) });
  if (!explicit.length) return result("robots_ai", "warn", "robots.txt has no explicit rules for AI bots (allowed by default, undeclared)", { url, http: http(res), data: { allowed: true } });
  return result("robots_ai", "pass", `robots.txt allows ${explicit.join(", ")}${/llms\.txt/i.test(res.text) ? "; points to /llms.txt" : ""}`, { url, http: http(res) });
}

export function parseRobots(text) {
  const groups = new Map();
  let current = [];
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      const name = value.toLowerCase();
      if (!groups.has(name)) groups.set(name, { allow: [], disallow: [] });
      // Consecutive User-agent lines share the directives that follow; a User-agent after a directive starts a new set.
      current = lastWasAgent ? [...current, groups.get(name)] : [groups.get(name)];
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (value) for (const g of current) g[key].push(value);
    }
  }
  return groups;
}

export async function agentJson(base) {
  for (const path of ["/.well-known/agent.json", "/agents.json", "/.well-known/agent-card.json"]) {
    const url = joinUrl(base, path);
    const res = await get(url);
    if (res.ok && res.status === 200 && !isHtml(res) && parseJson(res)) {
      const doc = parseJson(res);
      const keys = Object.keys(doc).slice(0, 8).join(", ");
      return result("agent_json", "pass", `${path} present (${keys})`, { url, http: http(res), data: { path, keys: Object.keys(doc) } });
    }
  }
  return result("agent_json", "fail", "no agent manifest at /.well-known/agent.json or /agents.json", { url: joinUrl(base, "/.well-known/agent.json"), http: { method: "GET", status: 404 } });
}

export async function llmsTxt(base) {
  const url = joinUrl(base, "/llms.txt");
  const res = await get(url);
  if (!res.ok || res.status !== 200 || isHtml(res)) return result("llms_txt", "fail", `/llms.txt ${res.status || res.error}${res.ok && isHtml(res) ? " (HTML, not text)" : ""}`, { url, http: http(res) });
  const links = (res.text.match(/\]\((https?:\/\/[^)]+|\/[^)]+)\)/g) || []).length;
  const mdLinks = (res.text.match(/\.md\)/g) || []).length;
  const kb = (res.text.length / 1024).toFixed(1);
  if (res.text.length < 200) return result("llms_txt", "warn", `/llms.txt is only ${res.text.length} bytes`, { url, http: http(res) });
  return result("llms_txt", "pass", `/llms.txt ${kb} KB, ${links} links${links ? ` (${mdLinks} to .md)` : ""}`, { url, http: http(res), data: { bytes: res.text.length, links, mdLinks } });
}

const OPENAPI_PATHS = ["/openapi.json", "/.well-known/openapi.json", "/openapi.yaml", "/v3/api-docs", "/api-docs", "/swagger.json"];
const GRAPHQL_PATHS = ["/graphql", "/api/graphql"];
// A link that looks like a spec, on any host: a spec published on a docs CDN or
// a raw file host is still the spec this product publishes.
const SPEC_LINK_RE = /https?:\/\/[^\s"'<>()\]]*(?:openapi|swagger)[^\s"'<>()\]]*\.(?:json|ya?ml)/gi;

function openapiFrom(res, where) {
  const doc = parseJson(res);
  if (doc && (doc.openapi || doc.swagger)) {
    const paths = Object.keys(doc.paths || {});
    return result("openapi", "pass", `${where}: OpenAPI ${doc.openapi || doc.swagger}, ${paths.length} paths`, { url: res.url, http: http(res), data: { path: where, version: doc.openapi || doc.swagger, paths, doc } });
  }
  if (/^openapi:/m.test(res.text)) return result("openapi", "pass", `${where}: OpenAPI (yaml)`, { url: res.url, http: http(res), data: { path: where, paths: [] } });
  return null;
}

// Reading surfaces an agent would already have fetched, mined for a spec link.
// Probing six fixed paths and then reporting "no OpenAPI document" says more
// than was observed: stripe.com publishes one, just not at a guessed path.
async function linkedSpec(base) {
  const seen = new Set();
  for (const surface of ["/llms.txt", "/", "/docs", "/docs/api", "/api"]) {
    const page = await get(joinUrl(base, surface));
    if (!page.ok || page.status !== 200) continue;
    for (const link of (page.text.match(SPEC_LINK_RE) || []).slice(0, 4)) {
      if (seen.has(link)) continue;
      seen.add(link);
      const res = await get(link);
      if (!res.ok || res.status !== 200 || isHtml(res)) continue;
      const hit = openapiFrom(res, link);
      if (hit) return { ...hit, detail: `${hit.detail}, linked from ${surface}` };
    }
    if (seen.size >= 6) break;
  }
  return null;
}

// GraphQL is a machine-readable interface too, and a product that serves one is
// not unable to describe itself. Checked with GET only, like every other probe:
// a GraphQL server answers a query-less GET with its own error, and many serve
// an explorer page. Neither submits anything.
function graphqlCandidates(base) {
  const urls = GRAPHQL_PATHS.map((path) => joinUrl(base, path));
  // The API usually lives on its own host: linear.app serves the marketing site,
  // api.linear.app serves the GraphQL an agent would actually call.
  // joinUrl above already threw on a base that does not parse, so this cannot fail.
  const u = new URL(base);
  const named = u.hostname.includes(".") && !isIP(u.hostname) && !u.port;
  if (named && !u.hostname.startsWith("api.")) urls.push(`${u.protocol}//api.${u.hostname.replace(/^www\./, "")}/graphql`);
  return urls;
}

async function graphqlEndpoint(base) {
  for (const url of graphqlCandidates(base)) {
    const path = new URL(url).host === new URL(base).host ? new URL(url).pathname : url;
    const res = await get(url);
    if (!res.ok || res.status === 404) continue;
    const body = res.text.slice(0, 4000);
    const errors = parseJson(res)?.errors;
    const speaksGraphql = (Array.isArray(errors) && /query|operation|graphql/i.test(JSON.stringify(errors))) || /graphiql|graphql playground|apollo sandbox/i.test(body);
    if (speaksGraphql) return result("openapi", "pass", `${path} serves a GraphQL API, which an agent can introspect; no OpenAPI document`, { url, http: http(res), data: { path, kind: "graphql", paths: [] } });
  }
  return null;
}

export async function openapi(base) {
  for (const path of OPENAPI_PATHS) {
    const url = joinUrl(base, path);
    const res = await get(url);
    if (!res.ok || res.status !== 200 || isHtml(res)) continue;
    const hit = openapiFrom(res, path);
    if (hit) return hit;
  }
  return (await linkedSpec(base))
    || (await graphqlEndpoint(base))
    || result("openapi", "fail", `no machine-readable API description: nothing at ${OPENAPI_PATHS.length} common paths, no spec linked from /llms.txt, the homepage or docs, and no GraphQL endpoint at ${GRAPHQL_PATHS.join(" or ")}`, { url: joinUrl(base, "/openapi.json"), http: { method: "GET", status: 404 } });
}

export async function pricingJson(base) {
  const url = joinUrl(base, "/pricing.json");
  const res = await get(url);
  // A single-page app answers every path with its shell, so this probe's most
  // common failure is a 200 that carries HTML. Reporting that as "/pricing.json
  // 200" reads as a pass and hides the reason, so each cause says itself.
  if (!res.ok) return result("pricing_json", "fail", `/pricing.json could not be fetched: ${res.error}`, { url, http: http(res) });
  if (res.status !== 200) return result("pricing_json", "fail", `/pricing.json ${res.status}`, { url, http: http(res) });
  if (isHtml(res)) return result("pricing_json", "fail", "/pricing.json returns 200 but serves HTML, not pricing JSON", { url, http: http(res) });
  const doc = parseJson(res);
  if (!doc) return result("pricing_json", "fail", "/pricing.json is not valid JSON", { url, http: http(res) });
  const missing = PRICING_SCHEMA.required.filter((k) => !(k in doc));
  const plans = Array.isArray(doc.plans) ? doc.plans.length : 0;
  const signupUrl = Array.isArray(doc.plans) ? doc.plans.map((p) => p?.trial?.api_provisioning_url).find(Boolean) : null;
  if (missing.length) return result("pricing_json", "warn", `/pricing.json exists but is not agent-serve pricing.json (missing ${missing.join(", ")})`, { url, http: http(res), data: { missing, keys: Object.keys(doc) } });
  return result("pricing_json", "pass", `/pricing.json follows the agent-serve schema: ${plans} plan(s)${signupUrl ? ", provisioning URL advertised" : ""}`, { url, http: http(res), data: { plans, signupUrl } });
}

export async function catalogPricing(base, slug) {
  if (!slug) return result("catalog_pricing", "skip", "no catalog slug given (--catalog-slug)");
  const url = joinUrl(base, `/public/v1/catalog/${slug}/pricing.json`);
  const res = await get(url);
  if (!res.ok || res.status !== 200) return result("catalog_pricing", "fail", `catalog pricing.json ${res.status || res.error} (slug may be wrong or public catalog disabled)`, { url, http: http(res) });
  const doc = parseJson(res);
  if (!doc) return result("catalog_pricing", "warn", `catalog pricing.json is not valid JSON: ${excerpt(res.text, 120)}`, { url, http: http(res) });
  const signupUrl = Array.isArray(doc?.plans) ? doc.plans.map((p) => p?.trial?.api_provisioning_url).find(Boolean) : null;
  return result("catalog_pricing", signupUrl ? "pass" : "warn", signupUrl ? `catalog pricing.json: ${doc.plans.length} plan(s), api_provisioning_url advertised` : "catalog pricing.json present but no plan advertises api_provisioning_url (agent signup off)", { url, http: http(res), data: { signupUrl, plans: doc?.plans?.length ?? 0 } });
}

export async function captcha(base) {
  for (const path of SIGNUP_PATHS) {
    const url = joinUrl(base, path);
    const res = await get(url);
    if (!res.ok || res.status !== 200 || !isHtml(res)) continue;
    const hits = [...new Set((res.text.match(CAPTCHA_RE) || []).map((s) => s.toLowerCase()))];
    const emailOnly = /verif(y|ication)\s+(your\s+)?email|check your inbox|magic link/i.test(res.text);
    if (hits.length) return result("captcha", "fail", `${path} loads ${hits.join(", ")}; an agent cannot pass it`, { url, http: http(res), data: { path, hits } });
    if (emailOnly) return result("captcha", "warn", `${path} has no CAPTCHA but mentions email verification`, { url, http: http(res), data: { path } });
    return result("captcha", "pass", `${path} has no CAPTCHA script`, { url, http: http(res), data: { path } });
  }
  return result("captcha", "skip", `no signup page found at ${SIGNUP_PATHS.join(", ")}`);
}

export async function signupEndpoint(base, { openapiDoc = null, pricingSignupUrl = null } = {}) {
  const candidates = [];
  if (pricingSignupUrl) candidates.push({ url: pricingSignupUrl, source: "pricing.json api_provisioning_url", returnsKey: true });
  if (openapiDoc?.paths) {
    for (const [path, ops] of Object.entries(openapiDoc.paths)) {
      if (!ops?.post || !SIGNUP_API_RE.test(path)) continue;
      const responses = JSON.stringify(ops.post.responses || {});
      const returnsKey = /api[_-]?key|apiKey|token|secret/i.test(responses) || /api[_-]?key|apiKey/i.test(JSON.stringify(openapiDoc.components || {}).slice(0, 20000));
      candidates.push({ url: joinUrl(base, path), source: `openapi POST ${path}`, returnsKey });
    }
  }
  if (!candidates.length) {
    for (const path of ["/v1/accounts", "/api/v1/accounts", "/api/signup", "/v1/signup"]) {
      const url = joinUrl(base, path);
      const res = await get(url, { method: "OPTIONS" });
      if (res.ok && res.status < 400 && /post/i.test(res.headers.allow || res.headers["access-control-allow-methods"] || "")) candidates.push({ url, source: `OPTIONS ${path} allows POST`, returnsKey: false });
    }
  }
  if (!candidates.length) return result("signup_endpoint", "warn", "no JSON signup endpoint discoverable (pricing.json, OpenAPI, or OPTIONS on common paths)", { url: joinUrl(base, "/v1/accounts"), http: { method: "OPTIONS", status: 0 } });
  const best = candidates.find((c) => c.returnsKey) || candidates[0];
  return result("signup_endpoint", "pass", `signup endpoint advertised: ${best.source}${best.returnsKey ? " (response carries a credential)" : ""}`, { url: best.url, http: { method: "OPTIONS", status: 0 }, data: { returnsKey: best.returnsKey, candidates: candidates.map((c) => c.source) } });
}

export async function http402(base, { openapiDoc = null } = {}) {
  if (!openapiDoc?.paths) return result("http_402", "skip", "no OpenAPI document to inspect purchase endpoints");
  const purchase = Object.entries(openapiDoc.paths).filter(([path, ops]) => PURCHASE_API_RE.test(path) && (ops?.post || ops?.patch));
  if (!purchase.length) return result("http_402", "warn", "OpenAPI documents no purchase, subscription or credits endpoint", { url: joinUrl(base, "/openapi.json"), http: { method: "GET", status: 200 } });
  const with402 = purchase.filter(([, ops]) => Object.values(ops).some((op) => op?.responses && "402" in op.responses));
  if (with402.length) return result("http_402", "pass", `${with402.length} purchase endpoint(s) document a 402 fallback: ${with402.map(([p]) => p).slice(0, 3).join(", ")}`, { url: joinUrl(base, "/openapi.json"), http: { method: "GET", status: 200 }, data: { paths: with402.map(([p]) => p) } });
  return result("http_402", "warn", `${purchase.length} purchase endpoint(s) documented, none returns 402 (agent gets no machine-readable payment handoff): ${purchase.map(([p]) => p).slice(0, 3).join(", ")}`, { url: joinUrl(base, "/openapi.json"), http: { method: "GET", status: 200 }, data: { paths: purchase.map(([p]) => p) } });
}

// Run every probe against a base URL. Probes never submit forms or create anything.
export async function runProbes(base, { catalogSlug = null, log = () => {} } = {}) {
  const out = [];
  const push = (r) => {
    out.push(r);
    log(r);
    return r;
  };
  push(await robotsAi(base));
  push(await agentJson(base));
  push(await llmsTxt(base));
  const oa = push(await openapi(base));
  const pj = push(await pricingJson(base));
  push(await catalogPricing(base, catalogSlug));
  push(await captcha(base));
  push(await signupEndpoint(base, { openapiDoc: oa.data?.doc || null, pricingSignupUrl: pj.data?.signupUrl || null }));
  push(await http402(base, { openapiDoc: oa.data?.doc || null }));
  // The full OpenAPI doc is useful to probes but too big for scan.json.
  for (const r of out) if (r.data?.doc) delete r.data.doc;
  return out;
}

export { excerpt };
