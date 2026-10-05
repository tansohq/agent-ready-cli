import { RANK } from "../schema/stages.js";

// previous = history lines for this target, oldest first.
export function computeDelta(report, previous) {
  if (!previous?.length) return null;
  const current = new Set(report.providersRun);
  const newestFirst = [...previous].reverse();
  // Prefer a run that covered at least what this run covered, so a scan-only run never "fixes" audit findings it did not re-test.
  const comparable = newestFirst.find((line) => report.providersRun.every((p) => line.providersRun.includes(p))) || newestFirst[0];

  const stages = report.stages.map((s) => {
    const from = comparable.stages[s.id] ?? "NOT_TESTED";
    const to = s.state;
    let direction = "same";
    if (from !== to) {
      const rf = RANK[from];
      const rt = RANK[to];
      direction = rf === undefined || rt === undefined ? "changed" : rt > rf ? "up" : "down";
    }
    return { id: s.id, from, to, direction };
  });

  const nowIds = new Set(report.findings.map((f) => f.id));
  const prevIds = new Set(comparable.findingIds || []);
  const earlier = previous.slice(0, -1).slice(-20);
  const seenEarlier = (id) => earlier.some((line) => (line.findingIds || []).includes(id));

  const newIds = [];
  const regressed = [];
  for (const id of nowIds) {
    if (prevIds.has(id)) continue;
    if (seenEarlier(id)) regressed.push(id);
    else newIds.push(id);
  }
  const fixed = [...prevIds].filter((id) => !nowIds.has(id) && comparable.findingProviders?.[id] && current.has(comparable.findingProviders[id]));
  const persisted = [...nowIds].filter((id) => prevIds.has(id));

  return {
    previousRunId: comparable.runId,
    previousAt: comparable.at,
    stages,
    findings: { new: newIds, fixed, regressed, persisted },
    fixedDetails: fixed.map((id) => comparable.findingText?.[id] ? { id, text: comparable.findingText[id], stage: comparable.findingStage?.[id] } : { id }),
    headline: { from: comparable.headline, to: { cleared: report.headline.cleared, of: report.headline.of, stalledAt: report.headline.stalledAt } },
    maturity: { from: comparable.maturity, to: report.maturity.level },
    humanInterventions: { from: comparable.humanInterventions ?? null, to: report.headline.humanInterventions },
  };
}

export function historyLine(report) {
  return {
    runId: report.runId,
    at: report.generatedAt,
    target: report.target,
    task: report.task,
    claims: report.claims,
    providersRun: report.providersRun,
    crashMode: report.sources.crash?.mode ?? null,
    stages: Object.fromEntries(report.stages.map((s) => [s.id, s.state])),
    findingIds: report.findings.map((f) => f.id),
    findingProviders: Object.fromEntries(report.findings.map((f) => [f.id, f.provider])),
    findingText: Object.fromEntries(report.findings.map((f) => [f.id, f.text])),
    findingStage: Object.fromEntries(report.findings.map((f) => [f.id, f.stage])),
    headline: { cleared: report.headline.cleared, of: report.headline.of, stalledAt: report.headline.stalledAt },
    humanInterventions: report.headline.humanInterventions,
    maturity: report.maturity.level,
    devReadiness: report.devReadiness.band,
  };
}
