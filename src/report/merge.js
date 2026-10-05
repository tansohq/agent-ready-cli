import { STAGES, PILLAR, STOPS_AT, RANK, MATURITY_LABEL, STAGE_LABEL, atLeast } from "../schema/stages.js";
import { fromScan, fromAudit, fromCrash, lowest } from "../schema/map.js";
import { findingId, similarity } from "../schema/ids.js";
import { computeDelta } from "./delta.js";

const WEIGHT_RANK = { observed: 0, judged: 1, acted: 2 };

export function merge({ scan = null, audit = null, crash = null, claims, task = "", previous = [], runId, target, version = "0.0.0", generatedAt = new Date().toISOString() }) {
  const claimed = { web: true, onboarding: true, monetization: true, ...(claims || {}) };
  const providersRun = [];
  if (scan) providersRun.push("scan");
  if (audit) providersRun.push("audit");
  if (crash) providersRun.push("crash");

  const s = fromScan(scan);
  const a = fromAudit(audit);
  const c = fromCrash(crash);
  const allVotes = [...s.votes, ...a.votes, ...c.votes];
  let findings = dedupe([...s.findings, ...a.findings, ...c.findings]);
  const lastRun = previous.length ? previous[previous.length - 1] : null;

  const stages = STAGES.map((id) => {
    const pillar = PILLAR[id];
    const applicable = claimed[pillar];
    const votes = allVotes.filter((v) => v.stage === id);
    const evidence = votes.map((v) => {
      const e = { provider: v.provider, ref: v.ref, vote: v.state, weight: v.weight, note: v.note };
      if (!applicable) e.suppressed = true;
      return e;
    });
    const stageFindings = findings.filter((f) => f.stage === id);

    if (!applicable) return { id, pillar, label: STAGE_LABEL[id], state: "NOT_APPLICABLE", stopsAt: STOPS_AT[id], evidence, findings: stageFindings };
    if (!votes.length) return { id, pillar, label: STAGE_LABEL[id], state: "NOT_TESTED", stopsAt: STOPS_AT[id], evidence, findings: stageFindings };

    // Rule 10: an acted BLOCKED counts only when confirmed (HTTP >= 400 or a prior failing run); otherwise it votes HUMAN_REQUIRED.
    const previouslyFailed = lastRun?.stages?.[id] === "BLOCKED";
    const effective = votes.map((v) => {
      if (v.weight === "acted" && v.state === "BLOCKED" && !v.confirmed && !previouslyFailed) {
        evidence.push({ provider: "agent-ready", ref: `merge:${id}`, vote: "HUMAN_REQUIRED", weight: "observed", note: "unconfirmed_browser_block" });
        const text = `Browser run reported ${id} blocked without an HTTP failure or a prior failing run. Re-run to confirm before treating as blocked.`;
        findings.push({ id: findingId(id, text), stage: id, severity: "low", provider: "agent-ready", text, ref: `merge:${id}` });
        return { ...v, state: "HUMAN_REQUIRED" };
      }
      return v;
    });
    // Rule 2: highest-weight provider decides. Judged/acted votes are few, so the lowest wins; observed votes are many
    // independent checks, so the median wins and one weak benchmark cannot sink a stage on its own.
    const topWeight = Math.max(...effective.map((v) => WEIGHT_RANK[v.weight]));
    const deciding = effective.filter((v) => WEIGHT_RANK[v.weight] === topWeight).map((v) => v.state);
    let state = topWeight === WEIGHT_RANK.observed ? median(deciding) : deciding.reduce(lowest);
    // Rule 3: a confirmed acted BLOCKED overrides everything.
    if (effective.some((v) => v.weight === "acted" && v.state === "BLOCKED")) state = "BLOCKED";
    // Rule 3b: observed hard fails cap the stage.
    for (const cap of s.caps.filter((x) => x.stage === id)) state = lowest(state, cap.max);
    // Rule 4: ceilings.
    if (state === "AGENT_VERIFIED" && !votes.some((v) => v.weight === "acted" && v.state === "AGENT_VERIFIED")) state = "AGENT_CAPABLE";

    return { id, pillar, label: STAGE_LABEL[id], state, stopsAt: STOPS_AT[id], evidence, findings: findings.filter((f) => f.stage === id) };
  });

  const applicable = stages.filter((st) => st.state !== "NOT_APPLICABLE");
  let cleared = 0;
  let stalled = null;
  for (const st of applicable) {
    if (atLeast(st.state, "AGENT_CAPABLE")) cleared++;
    else {
      stalled = st;
      break;
    }
  }
  const stalledAt = stalled ? (stalled.state === "NOT_TESTED" ? "unsure" : stalled.stopsAt) : null;
  const stalledStage = stalled ? stalled.id : null;
  const headlineText = stalled
    ? `Agent cleared ${cleared} of ${applicable.length} stages unassisted. ${stalled.state === "NOT_TESTED" ? `Not tested past ${stalled.id}.` : `Stalled at ${stalled.id}.`}`
    : `Agent cleared all ${applicable.length} stages unassisted.`;

  const maturity = computeMaturity(stages, applicable, claimed);
  if (audit?.available && Number.isInteger(audit.maturity) && Math.abs(audit.maturity - maturity.level) >= 2) {
    const text = `Audit judged maturity L${audit.maturity}; funnel evidence computes L${maturity.level}.`;
    findings.push({ id: findingId("understand", text), stage: "understand", severity: "low", provider: "agent-ready", text, ref: "merge:maturity_disagreement" });
  }

  const devScore = audit?.available && Number.isInteger(audit.areas?.dev_readiness?.score) ? audit.areas.dev_readiness.score : null;
  const devReadiness = { score: devScore, band: devScore === null ? "not_tested" : devScore <= 2 ? "none" : devScore <= 5 ? "low" : devScore <= 8 ? "mid" : "high" };

  const humanInterventions = crash?.available ? crash.flows.reduce((n, f) => n + (f.human_interventions || 0), 0) : null;

  const report = {
    schema: "agent-ready/report@1",
    runId,
    target,
    generatedAt,
    version,
    task,
    claims: claimed,
    providersRun,
    stages,
    headline: { cleared, of: applicable.length, stalledAt, stalledStage, humanInterventions, text: headlineText },
    maturity,
    devReadiness,
    findings: findings.filter((f) => stages.find((st) => st.id === f.stage)?.state !== "NOT_APPLICABLE"),
    worked: crash?.available ? crash.worked : [],
    delta: null,
    sources: { scan, audit, crash },
  };
  report.delta = computeDelta(report, previous);
  return report;
}

const SEV_RANK = { high: 0, med: 1, low: 2 };
const BY_RANK = ["BLOCKED", "HUMAN_REQUIRED", "AGENT_CAPABLE", "AGENT_VERIFIED"];

function median(states) {
  const ranks = states.map((st) => RANK[st]).sort((a, b) => a - b);
  return BY_RANK[ranks[Math.floor((ranks.length - 1) / 2)]];
}

const NEAR = 0.6;

// One defect, one row. Scan, audit and crash describe the same wall in different words, so identical ids collapse and,
// within a stage, findings that share most of their significant words collapse too. The most severe wording wins.
function dedupe(findings) {
  const out = [];
  for (const f of findings) {
    const match = out.find((seen) => seen.id === f.id || (seen.stage === f.stage && !seen.benchmark && !f.benchmark && similarity(seen.text, f.text) >= NEAR));
    if (!match) {
      out.push({ ...f, providers: [f.provider] });
      continue;
    }
    if (!match.providers.includes(f.provider)) match.providers.push(f.provider);
    if (SEV_RANK[f.severity] < SEV_RANK[match.severity] || (f.severity === match.severity && f.provider === "crash")) {
      Object.assign(match, { severity: f.severity, provider: f.provider, text: f.text, ref: f.ref, id: match.id });
    }
    for (const key of ["fix", "command", "docLine"]) if (!match[key] && f[key]) match[key] = f[key];
  }
  return out;
}

// Levels follow agent-serve maturity.md: L2 needs onboarding, L3+ needs payment. A product that claims only the web
// pillar tops out at L1 no matter how well it does there.
function computeMaturity(stages, applicable, claimed) {
  const by = Object.fromEntries(stages.map((s) => [s.id, s.state]));
  const all = (pred) => applicable.every((s) => pred(s.state));
  const ok = (id) => atLeast(by[id], "AGENT_CAPABLE");
  let level;
  let reason;
  if (claimed.monetization && claimed.onboarding && applicable.length && all((st) => st === "AGENT_VERIFIED")) [level, reason] = [4, "every stage verified by a live agent run"];
  else if (claimed.monetization && claimed.onboarding && all((st) => atLeast(st, "AGENT_CAPABLE")) && ok("pay")) [level, reason] = [3, "machine path exists at every stage including payment"];
  else if (claimed.onboarding && ok("signup") && ok("access")) [level, reason] = [2, claimed.monetization ? "agent can sign up and get a key; payment still needs a human" : "agent can sign up and get a key; monetization not claimed"];
  else if (ok("discover") && ok("understand") && !["discover", "understand"].some((id) => by[id] === "BLOCKED")) [level, reason] = [1, "agent can find and read the product; no programmatic onboarding"];
  else [level, reason] = [0, "agent cannot reliably find or read the product"];
  return { level, label: MATURITY_LABEL[level], reason };
}

export { RANK };
