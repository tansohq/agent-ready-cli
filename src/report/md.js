import { PILLARS } from "../schema/stages.js";

const MARK = { AGENT_VERIFIED: "●", AGENT_CAPABLE: "◉", HUMAN_REQUIRED: "◐", BLOCKED: "✕", NOT_TESTED: "○", NOT_APPLICABLE: "–" };
const WORD = { AGENT_VERIFIED: "verified", AGENT_CAPABLE: "capable", HUMAN_REQUIRED: "human required", BLOCKED: "blocked", NOT_TESTED: "not tested", NOT_APPLICABLE: "n/a" };
const SEV = { high: "F-high", med: "F-med", low: "F-low" };

export function renderMarkdown(report, { previousLabel = null } = {}) {
  const host = report.target.url ? new URL(report.target.url).host : report.target.dir;
  const h = report.headline;
  const d = report.delta;
  const lines = [];
  const stalledStage = h.stalledStage ? report.stages.find((s) => s.id === h.stalledStage) : null;
  const RANKS = { BLOCKED: 0, HUMAN_REQUIRED: 1, AGENT_CAPABLE: 2, AGENT_VERIFIED: 3 };
  const stalledNote = stalledStage ? [...stalledStage.evidence].filter((e) => !e.suppressed).sort((a, b) => (RANKS[a.vote] ?? 9) - (RANKS[b.vote] ?? 9))[0]?.note : null;
  lines.push(`# agent-ready: ${host}`);
  lines.push("");
  lines.push(`Task: ${report.task || "unspecified"}  `);
  lines.push(`Run: ${report.runId} · ${report.generatedAt.slice(0, 10)} · ${report.providersRun.join(" + ")}${d ? ` · vs ${previousLabel || d.previousAt?.slice(0, 10)}` : ""}`);
  lines.push("");
  lines.push(`## ${h.cleared} / ${h.of} stages cleared unassisted${d ? ` (was ${d.headline.from.cleared} / ${d.headline.from.of})` : ""}`);
  lines.push("");
  lines.push(h.text);
  if (stalledNote) lines.push(`Why: ${stalledNote}`);
  if (h.humanInterventions !== null) lines.push(`Human interventions: ${h.humanInterventions}${d && d.humanInterventions.from !== null ? ` (was ${d.humanInterventions.from})` : ""}`);
  lines.push(`Maturity: Level ${report.maturity.level} · ${report.maturity.label} · ${report.maturity.reason}`);
  if (report.devReadiness.score !== null) lines.push(`Dev readiness: ${report.devReadiness.score}/10 (${report.devReadiness.band})`);
  lines.push("");
  lines.push("## Funnel");
  lines.push("");
  lines.push("| Pillar | Stage | State | Was |");
  lines.push("|---|---|---|---|");
  for (const pillar of PILLARS) {
    for (const s of report.stages.filter((x) => x.pillar === pillar)) {
      const from = d?.stages.find((x) => x.id === s.id);
      lines.push(`| ${pillar} | ${s.id} | ${MARK[s.state]} ${WORD[s.state]} | ${from && from.direction !== "same" ? WORD[from.from] : ""} |`);
    }
  }
  lines.push("");
  const stalled = h.stalledStage ? report.stages.find((s) => s.id === h.stalledStage) : null;
  const quote = stalled ? report.sources.crash?.flows?.find((f) => f.id === stalled.id)?.quote : null;
  if (quote) {
    lines.push(`> ${quote}`);
    lines.push(`> — the agent, at ${stalled.id}`);
    lines.push("");
  }
  const findings = [...report.findings].sort((a, b) => ({ high: 0, med: 1, low: 2 })[a.severity] - ({ high: 0, med: 1, low: 2 })[b.severity]);
  const first = findings.find((f) => f.stage === h.stalledStage && f.severity === "high") || findings[0];
  if (first) {
    lines.push("## Fix this first");
    lines.push("");
    lines.push(`**${first.stage}** · ${first.text}`);
    if (first.fix) lines.push(`Build: ${first.fix}`);
    if (first.command || first.docLine) lines.push(`\`${first.command || ""}\` ${first.docLine || ""}`.trim());
    lines.push("");
  }
  if (d?.fixedDetails?.length || d?.stages.some((s) => s.direction !== "same")) {
    lines.push(`## Since ${previousLabel || d.previousAt?.slice(0, 10)}`);
    lines.push("");
    for (const s of d.stages.filter((x) => x.direction !== "same")) lines.push(`- ${s.id}: ${WORD[s.from]} → ${WORD[s.to]} (${s.direction})`);
    for (const f of d.fixedDetails) lines.push(`- fixed: ${f.stage ? `${f.stage} · ` : ""}${f.text || f.id}`);
    for (const id of d.findings.regressed) lines.push(`- regressed: ${report.findings.find((f) => f.id === id)?.text || id}`);
    lines.push("");
  }
  lines.push("## Findings");
  lines.push("");
  lines.push("| Grade | Stage | Finding | Source | Fix |");
  lines.push("|---|---|---|---|---|");
  for (const f of findings.filter((x) => !x.benchmark)) lines.push(`| ${SEV[f.severity]} | ${f.stage} | ${cell(f.text)} | ${cell(f.command || f.docLine || f.ref || "")} | ${cell(f.fix || "")} |`);
  for (const w of report.worked) lines.push(`| (+) | | ${cell(w)} | | |`);
  lines.push("");
  const bench = findings.filter((x) => x.benchmark);
  if (bench.length) {
    lines.push("<details><summary>" + bench.length + " failing third-party benchmark checks</summary>");
    lines.push("");
    lines.push("| Stage | Check |");
    lines.push("|---|---|");
    for (const f of bench) lines.push(`| ${f.stage} | ${cell(f.text)} |`);
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  const src = [];
  if (report.sources.scan) src.push(`scan${report.sources.scan.aeo ? ` (aeo ${report.sources.scan.aeo.averageScore})` : ""}`);
  if (report.sources.audit) src.push(`audit (L${report.sources.audit.maturity})`);
  if (report.sources.crash) src.push(`crash (${report.sources.crash.persona})`);
  lines.push(`Sources: ${src.join(" · ")}`);
  lines.push("");
  return lines.join("\n");
}

function cell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
