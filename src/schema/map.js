import { ADVISORY_PROBES, AUDIT_AREA_STAGE, PROBE_STAGE, RANK } from "./stages.js";
import { findingId } from "./ids.js";

// Each provider turns its raw output into votes and findings.
// vote = { stage, state, weight, provider, ref, note }
// finding = { id, stage, severity, provider, text, fix?, ref? }

const CHECK_STATE = { pass: "AGENT_CAPABLE", ok: "AGENT_CAPABLE", warn: "HUMAN_REQUIRED", fail: "BLOCKED" };
const DISCOVER_CHECK = /robots|sitemap|crawl|bot/i;
// A failing probe is high severity only when it stops an agent outright; a missing manifest is a gap, not a wall.
const HARD_PROBES = new Set(["captcha", "robots_ai"]);

function lowest(a, b) {
  return RANK[a] <= RANK[b] ? a : b;
}

function vote(provider, weight, stage, state, ref, note) {
  return { stage, state, weight, provider, ref, note };
}

function finding(provider, stage, severity, ref, text, fix) {
  const f = { id: findingId(stage, text), stage, severity, provider, text, ref };
  if (fix) f.fix = fix;
  return f;
}

export function fromScan(scan) {
  const votes = [];
  const findings = [];
  const caps = [];
  if (!scan || !scan.available) return { votes, findings, caps };

  for (const p of scan.probes) {
    const stage = PROBE_STAGE[p.id];
    if (!stage || p.status === "skip") continue;
    const ref = `scan:probe:${p.id}`;
    // A warn that the probe itself calls allowed -- an undeclared robots.txt is
    // the whole web's default -- is not a step that needs a person. It stays a
    // finding, because declaring the rule is still better than not.
    const state = p.status === "warn" && p.data?.allowed ? "AGENT_CAPABLE" : CHECK_STATE[p.status];
    if (!ADVISORY_PROBES.has(p.id)) votes.push(vote("scan", "observed", stage, state, ref, p.detail));
    if (p.id === "signup_endpoint" && p.status === "pass" && p.data?.returnsKey) {
      votes.push(vote("scan", "observed", "access", "AGENT_CAPABLE", ref, "signup response carries a credential"));
    }
    if (p.status === "fail" && (p.id === "captcha" || p.id === "robots_ai")) {
      caps.push({ stage, max: "HUMAN_REQUIRED", ref, note: p.detail });
    }
    if (p.status === "fail") findings.push(finding("scan", stage, HARD_PROBES.has(p.id) ? "high" : "med", ref, p.detail));
    else if (p.status === "warn") findings.push(finding("scan", stage, "med", ref, p.detail));
  }

  // Third-party benchmarks vote by pass ratio per stage bucket, not by their weakest check: a site scoring 90+ with one
  // optional check failing is not blocked. Each failed check still becomes a low finding so the fix list is complete.
  const b = scan.aeo?.benchmarks || {};
  for (const name of ["cloudflare", "vercel", "fern", "agentgrade"]) {
    const bench = b[name];
    if (!bench?.available || !Array.isArray(bench.checks)) continue;
    const buckets = { discover: [], understand: [] };
    for (const c of bench.checks) {
      if (!CHECK_STATE[c.status]) continue;
      const stage = (name === "cloudflare" || name === "vercel") && DISCOVER_CHECK.test(c.id) ? "discover" : "understand";
      buckets[stage].push(c);
      if (c.status === "fail") findings.push({ ...finding("scan", stage, "low", `scan:${name}:${c.id}`, `${name}: ${c.id}${c.message ? ` — ${c.message}` : ""}`), benchmark: name });
    }
    for (const [stage, checks] of Object.entries(buckets)) {
      if (!checks.length) continue;
      const points = checks.reduce((n, c) => n + (c.status === "fail" ? 0 : c.status === "warn" ? 0.5 : 1), 0);
      const ratio = points / checks.length;
      const state = ratio >= 0.8 ? "AGENT_CAPABLE" : ratio >= 0.5 ? "HUMAN_REQUIRED" : "BLOCKED";
      const failed = checks.filter((c) => c.status === "fail").length;
      votes.push(vote("scan", "observed", stage, state, `scan:${name}`, `${name}: ${checks.length - failed}/${checks.length} checks pass${bench.grade ? ` (${bench.grade})` : ""}`));
    }
  }
  const seo = b.agenticSeo;
  if (seo?.available && typeof seo.score === "number") {
    const state = seo.score >= 70 ? "AGENT_CAPABLE" : seo.score >= 40 ? "HUMAN_REQUIRED" : "BLOCKED";
    votes.push(vote("scan", "observed", "understand", state, "scan:agenticSeo:score", `agentic-seo ${seo.score}/100`));
  }

  return { votes, findings, caps };
}

export function fromAudit(audit) {
  const votes = [];
  const findings = [];
  if (!audit || !audit.available) return { votes, findings };

  for (const [area, stage] of Object.entries(AUDIT_AREA_STAGE)) {
    const a = audit.areas?.[area];
    if (!a || typeof a.score !== "number") continue;
    const state = a.score <= 3 ? "BLOCKED" : a.score <= 7 ? "HUMAN_REQUIRED" : "AGENT_CAPABLE";
    const ref = `audit:${area}`;
    votes.push(vote("audit", "judged", stage, state, ref, `${a.score}/10 — ${a.today}`));
    for (const block of a.blocks || []) {
      const severity = a.score <= 3 ? "high" : "med";
      findings.push(finding("audit", stage, severity, ref, block, a.build));
    }
  }
  for (const hb of audit.hard_blockers || []) {
    const stage = AUDIT_AREA_STAGE[hb.area];
    if (stage) findings.push(finding("audit", stage, "high", `audit:${hb.area}`, hb.text));
  }
  for (const qw of audit.quick_wins || []) {
    const stage = AUDIT_AREA_STAGE[qw.area];
    if (stage) findings.push(finding("audit", stage, "low", `audit:${qw.area}`, qw.text, qw.text));
  }
  return { votes, findings };
}

export function fromCrash(crash) {
  const votes = [];
  const findings = [];
  if (!crash || !crash.available) return { votes, findings };

  for (const f of crash.flows) {
    if (f.result === "SKIP") continue;
    const ref = `crash:${f.id}`;
    let state;
    if (f.result === "FAIL") state = "BLOCKED";
    else state = f.human_interventions > 0 ? "HUMAN_REQUIRED" : "AGENT_VERIFIED";
    // A FAIL backed by a recorded HTTP exchange is hard evidence; a FAIL from a browser click alone is not (rule 10).
    votes.push({ ...vote("crash", "acted", f.id, state, ref, f.quote || f.result), confirmed: f.result !== "FAIL" || Boolean(f.http) });
  }
  const severity = { "F-high": "high", "F-med": "med", "F-low": "low" };
  for (const f of crash.findings) {
    const out = finding("crash", f.flow, severity[f.grade], `crash:${f.flow}`, f.text, f.fix);
    if (f.command) out.command = f.command;
    if (f.docLine) out.docLine = f.docLine;
    findings.push(out);
  }
  return { votes, findings };
}

export { lowest };
