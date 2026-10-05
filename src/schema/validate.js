import { STAGES, STATES, AUDIT_AREAS, PROBE_IDS } from "./stages.js";

class ValidationError extends Error {
  constructor(kind, problems) {
    super(`${kind} invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "ValidationError";
    this.problems = problems;
  }
}

function envelope(doc, kind, problems) {
  if (!doc || typeof doc !== "object") {
    problems.push("document is not an object");
    return;
  }
  if (doc.schema !== `agent-ready/${kind}@1`) problems.push(`schema must be "agent-ready/${kind}@1", got ${JSON.stringify(doc.schema)}`);
  if (typeof doc.runId !== "string" || !doc.runId) problems.push("runId missing");
  if (!doc.target || (!doc.target.url && !doc.target.dir)) problems.push("target.url or target.dir required");
  if (typeof doc.startedAt !== "string") problems.push("startedAt missing");
  if (typeof doc.finishedAt !== "string") problems.push("finishedAt missing");
  if (!doc.provider || typeof doc.provider.name !== "string") problems.push("provider.name missing");
  if (typeof doc.available !== "boolean") problems.push("available must be boolean");
}

export function validateScan(doc) {
  const problems = [];
  envelope(doc, "scan", problems);
  if (problems.length) throw new ValidationError("scan.json", problems);
  if (!("aeo" in doc)) problems.push("aeo missing (use null when not run)");
  if (!Array.isArray(doc.probes)) problems.push("probes must be an array");
  else
    doc.probes.forEach((p, i) => {
      if (!PROBE_IDS.includes(p.id)) problems.push(`probes[${i}].id unknown: ${p.id}`);
      if (!["pass", "fail", "warn", "skip"].includes(p.status)) problems.push(`probes[${i}].status invalid: ${p.status}`);
      if (typeof p.detail !== "string") problems.push(`probes[${i}].detail missing`);
    });
  if (problems.length) throw new ValidationError("scan.json", problems);
  return doc;
}

export function validateAudit(doc) {
  const problems = [];
  envelope(doc, "audit", problems);
  if (problems.length) throw new ValidationError("audit.json", problems);
  if (!doc.areas || typeof doc.areas !== "object") problems.push("areas missing");
  else
    for (const area of AUDIT_AREAS) {
      const a = doc.areas[area];
      if (!a) continue;
      if (!Number.isInteger(a.score) || a.score < 0 || a.score > 10) problems.push(`areas.${area}.score must be integer 0-10`);
      if (typeof a.today !== "string") problems.push(`areas.${area}.today missing`);
      if (!Array.isArray(a.blocks)) problems.push(`areas.${area}.blocks must be an array`);
      if (typeof a.build !== "string") problems.push(`areas.${area}.build missing`);
      if (!["S", "M", "L"].includes(a.effort)) problems.push(`areas.${area}.effort must be S|M|L`);
    }
  for (const key of ["hard_blockers", "quick_wins"]) {
    if (!Array.isArray(doc[key])) problems.push(`${key} must be an array`);
    else doc[key].forEach((f, i) => {
      if (!AUDIT_AREAS.includes(f.area)) problems.push(`${key}[${i}].area unknown: ${f.area}`);
      if (typeof f.text !== "string") problems.push(`${key}[${i}].text missing`);
    });
  }
  if (!Array.isArray(doc.roadmap)) problems.push("roadmap must be an array");
  if (!Number.isInteger(doc.maturity) || doc.maturity < 0 || doc.maturity > 4) problems.push("maturity must be integer 0-4");
  if (problems.length) throw new ValidationError("audit.json", problems);
  return doc;
}

export function validateCrash(doc) {
  const problems = [];
  envelope(doc, "crash", problems);
  if (problems.length) throw new ValidationError("crash.json", problems);
  if (!["smoke", "full"].includes(doc.mode)) problems.push("mode must be smoke|full");
  if (typeof doc.persona !== "string") problems.push("persona missing");
  if (typeof doc.task !== "string") problems.push("task missing");
  if (!Array.isArray(doc.flows)) problems.push("flows must be an array");
  else
    doc.flows.forEach((f, i) => {
      if (!STAGES.includes(f.id)) problems.push(`flows[${i}].id must be a stage id, got ${f.id}`);
      if (!["PASS", "FAIL", "SKIP"].includes(f.result)) problems.push(`flows[${i}].result must be PASS|FAIL|SKIP`);
      if (!Number.isInteger(f.human_interventions) || f.human_interventions < 0) problems.push(`flows[${i}].human_interventions must be integer >= 0`);
    });
  if (!Array.isArray(doc.findings)) problems.push("findings must be an array");
  else
    doc.findings.forEach((f, i) => {
      if (!STAGES.includes(f.flow)) problems.push(`findings[${i}].flow must be a stage id`);
      if (!["F-high", "F-med", "F-low"].includes(f.grade)) problems.push(`findings[${i}].grade must be F-high|F-med|F-low`);
      if (typeof f.text !== "string") problems.push(`findings[${i}].text missing`);
    });
  if (!Array.isArray(doc.worked)) problems.push("worked must be an array");
  if (typeof doc.human_assist !== "boolean") problems.push("human_assist must be boolean");
  if (problems.length) throw new ValidationError("crash.json", problems);
  return doc;
}

export function validateReport(doc) {
  const problems = [];
  if (doc?.schema !== "agent-ready/report@1") problems.push("schema must be agent-ready/report@1");
  if (!Array.isArray(doc?.stages) || doc.stages.length !== STAGES.length) problems.push(`stages must have ${STAGES.length} entries`);
  else
    doc.stages.forEach((s, i) => {
      if (s.id !== STAGES[i]) problems.push(`stages[${i}].id must be ${STAGES[i]}`);
      if (!STATES.includes(s.state)) problems.push(`stages[${i}].state invalid: ${s.state}`);
    });
  if (!doc?.headline || !Number.isInteger(doc.headline.cleared)) problems.push("headline.cleared missing");
  if (problems.length) throw new ValidationError("report.json", problems);
  return doc;
}

export { ValidationError };
