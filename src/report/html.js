import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { PILLARS } from "../schema/stages.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STATE_DOT = { AGENT_VERIFIED: "d-pass", AGENT_CAPABLE: "d-cap", HUMAN_REQUIRED: "d-fric", BLOCKED: "d-block", NOT_TESTED: "d-na", NOT_APPLICABLE: "d-na" };
const STATE_WORD = { AGENT_VERIFIED: "verified", AGENT_CAPABLE: "capable", HUMAN_REQUIRED: "human required", BLOCKED: "blocked", NOT_TESTED: "not tested", NOT_APPLICABLE: "n/a" };
const SEV_ORDER = { high: 0, med: 1, low: 2 };
const WEIGHTS = { observed: 0, judged: 1, acted: 2 };
const SEV_LABEL = { high: "F-high", med: "F-med", low: "F-low" };

function dataUri(assetDir, path) {
  if (!path || !assetDir) return null;
  const full = join(assetDir, path);
  if (!existsSync(full)) return null;
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(full).toLowerCase()] || "application/octet-stream";
  return `data:${mime};base64,${readFileSync(full).toString("base64")}`;
}

function crashFlow(report, stageId) {
  return report.sources.crash?.flows?.find((f) => f.id === stageId) || null;
}

function shortDate(iso) {
  return iso ? iso.slice(0, 10) : "";
}

export function renderHtml(report, { assetDir = null, previousLabel = null } = {}) {
  const host = report.target.url ? new URL(report.target.url).host : report.target.dir;
  const h = report.headline;
  const d = report.delta;
  const stalled = h.stalledStage ? report.stages.find((s) => s.id === h.stalledStage) : null;
  const stalledQuote = stalled ? crashFlow(report, stalled.id)?.quote : null;
  // Explain the stall with the evidence that held the stage back, not the first thing that happened to pass.
  const RANKS = { BLOCKED: 0, HUMAN_REQUIRED: 1, AGENT_CAPABLE: 2, AGENT_VERIFIED: 3 };
  const stalledEvidence = stalled
    ? [...stalled.evidence].filter((e) => !e.suppressed).sort((a, b) => (RANKS[a.vote] ?? 9) - (RANKS[b.vote] ?? 9) || WEIGHTS[b.weight] - WEIGHTS[a.weight])[0] || null
    : null;

  const findings = [...report.findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const first = findings.find((f) => f.stage === h.stalledStage && f.severity === "high") || findings[0] || null;
  const firstFlow = first ? crashFlow(report, first.stage) : null;
  const firstShot = firstFlow?.screenshot ? dataUri(assetDir, firstFlow.screenshot) : null;
  const buildFor = (stage) => {
    const areaEntry = Object.entries(report.sources.audit?.areas || {}).find(([area]) => ({ onboarding: "signup", authentication: "access", purchasing: "pay", usage_monitoring: "use", self_management: "manage" })[area] === stage);
    return areaEntry ? areaEntry[1] : null;
  };

  const rail = PILLARS.map((pillar) => {
    const steps = report.stages
      .filter((s) => s.pillar === pillar)
      .map((s) => {
        const from = d?.stages.find((x) => x.id === s.id);
        const ghost = from && from.direction !== "same" ? `<i class="dot ghost ${STATE_DOT[from.from]}" title="was ${esc(STATE_WORD[from.from])}"></i>` : "";
        return `<span class="step" title="${esc(STATE_WORD[s.state])}">${ghost}<i class="dot ${STATE_DOT[s.state]}"></i>${esc(s.id)}</span>`;
      })
      .join("");
    return `<div class="row"><div class="lbl">${esc(pillar)}</div><div class="steps">${steps}</div></div>`;
  }).join("");

  const nonPass = report.stages.filter((s) => ["BLOCKED", "HUMAN_REQUIRED"].includes(s.state));
  const cards = nonPass
    .map((s) => {
      const flow = crashFlow(report, s.id);
      const shot = flow?.screenshot ? dataUri(assetDir, flow.screenshot) : null;
      const area = buildFor(s.id);
      const evidenceRows = s.evidence
        .filter((e) => !e.suppressed)
        .map((e) => `<li><code>${esc(e.ref)}</code> <span class="vote ${STATE_DOT[e.vote] || ""}">${esc(STATE_WORD[e.vote] || e.vote)}</span> ${esc(e.note)}</li>`)
        .join("");
      return `<div class="card ${s.state === "BLOCKED" ? "blocked" : "friction"}">
  <div class="card-h"><i class="dot ${STATE_DOT[s.state]}"></i><span class="stage">${esc(s.pillar)} · ${esc(s.id)}</span><span class="state">${esc(STATE_WORD[s.state])}</span></div>
  ${flow?.quote ? `<blockquote>${esc(flow.quote)}<cite>the agent, ${esc(s.id)}</cite></blockquote>` : ""}
  ${area ? `<div class="triad"><div><b>Today</b>${esc(area.today)}</div>${area.blocks?.length ? `<div><b>Blocks agents</b>${area.blocks.map(esc).join("<br>")}</div>` : ""}<div><b>Build</b>${esc(area.build)}${area.effort ? ` <span class="pill">effort ${esc(area.effort)}</span>` : ""}${area.reference ? ` <span class="ref">ref: ${esc(area.reference)}</span>` : ""}</div></div>` : ""}
  ${shot ? `<img alt="${esc(s.id)} screenshot" src="${shot}">` : ""}
  ${flow?.http ? `<details><summary>http</summary><pre>${esc(flow.http.method)} ${esc(flow.http.url)} → ${esc(flow.http.status)}${flow.http.body ? `\n${esc(flow.http.body)}` : ""}</pre></details>` : ""}
  <details><summary>source detail (${s.evidence.filter((e) => !e.suppressed).length})</summary><ul class="ev">${evidenceRows}</ul></details>
</div>`;
    })
    .join("\n");

  const ups = d?.stages.filter((s) => s.direction === "up") || [];
  const fixedBlock = d && (d.fixedDetails.length || ups.length)
    ? `<h2>Fixed since ${esc(previousLabel || shortDate(d.previousAt))}</h2>
${ups.map((s) => `<div class="ba"><span class="ba-stage">${esc(s.id)}</span><span class="tag t-was">${esc(STATE_WORD[s.from])}</span><span class="arrow">→</span><span class="tag t-now">${esc(STATE_WORD[s.to])}</span></div>`).join("")}
<ul class="fixed">${d.fixedDetails.map((f) => `<li><span class="tag t-was">was</span> <span class="ba-stage">${esc(f.stage || "")}</span> ${esc(f.text || f.id)}</li>`).join("")}</ul>`
    : "";
  const regressedBlock = d?.stages.some((s) => s.direction === "down") || d?.findings.regressed.length
    ? `<h2 class="warn-h">Regressed since ${esc(previousLabel || shortDate(d.previousAt))}</h2>
${d.stages.filter((s) => s.direction === "down").map((s) => `<div class="ba"><span>${esc(s.id)}</span><span class="tag t-now">${esc(STATE_WORD[s.from])}</span><span class="arrow">→</span><span class="tag t-was">${esc(STATE_WORD[s.to])}</span></div>`).join("")}
${d.findings.regressed.map((id) => `<div class="ba"><span>${esc(report.findings.find((f) => f.id === id)?.text || id)}</span></div>`).join("")}`
    : "";

  const saw = (report.sources.crash?.flows || [])
    .filter((f) => f.screenshot)
    .map((f) => ({ f, uri: dataUri(assetDir, f.screenshot) }))
    .filter((x) => x.uri)
    .map(({ f, uri }) => `<figure><img alt="${esc(f.id)}" src="${uri}"><figcaption><i class="dot ${f.result === "PASS" ? (f.human_interventions ? "d-fric" : "d-pass") : f.result === "FAIL" ? "d-block" : "d-na"}"></i>${esc(f.id)}${f.quote ? ` · ${esc(f.quote)}` : ""}</figcaption></figure>`)
    .join("");
  const sawBlock = saw ? `<h2>What the agent saw</h2><div class="saw">${saw}</div>` : "";

  const own = findings.filter((f) => !f.benchmark);
  const bench = findings.filter((f) => f.benchmark);
  const row = (f) => `<tr><td class="sev-${f.severity}">${esc(SEV_LABEL[f.severity])}</td><td>${esc(f.stage)}</td><td>${esc(f.text)}${f.providers?.length > 1 ? ` <span class="ref">(${esc(f.providers.join(", "))})</span>` : ""}</td><td><code>${esc(f.command || f.docLine || f.ref || "")}</code></td><td>${esc(f.fix || "")}</td></tr>`;
  const rows = own
    .map(row)
    .concat(report.worked.map((w) => `<tr><td class="sev-plus">(+)</td><td></td><td>${esc(w)}</td><td></td><td></td></tr>`))
    .join("\n");
  const benchByName = bench.reduce((m, f) => ((m[f.benchmark] ||= []).push(f), m), {});
  const benchBlock = bench.length
    ? `<details class="bench"><summary>${bench.length} failing third-party benchmark checks (${Object.entries(benchByName).map(([n, list]) => `${esc(n)} ${list.length}`).join(", ")})</summary><div class="tbl"><table><tr><th>Grade</th><th>Stage</th><th>Check</th><th>Source</th><th>Fix</th></tr>${bench.map(row).join("\n")}</table></div></details>`
    : "";

  const sourcesLine = [
    report.sources.scan ? `scan${report.sources.scan.aeo ? ` · aeo ${report.sources.scan.aeo.averageScore}` : ""}` : null,
    report.sources.audit ? `audit L${report.sources.audit.maturity}` : null,
    report.sources.crash ? `crash ${report.sources.crash.flows.filter((f) => f.result === "PASS").length}/${report.sources.crash.flows.filter((f) => f.result !== "SKIP").length}` : null,
  ].filter(Boolean).join(" · ");

  const deltaCleared = d ? `<div class="delta ${d.headline.to.cleared >= d.headline.from.cleared ? "up" : "down"}">${d.headline.to.cleared >= d.headline.from.cleared ? "▲" : "▼"} from ${d.headline.from.cleared} / ${d.headline.from.of}</div>` : "";
  const hi = h.humanInterventions;
  const deltaHi = d && d.humanInterventions.from !== null && hi !== null ? `<div class="delta ${hi <= d.humanInterventions.from ? "up" : "down"}">${hi <= d.humanInterventions.from ? "▲" : "▼"} from ${d.humanInterventions.from}</div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-ready: ${esc(host)}</title>
<style>
:root{--bg:#f4f5f3;--card:#fff;--fg:#1b1d1c;--muted:#5f645f;--line:#d9ddd8;--accent:#1f5f8b;--accent-soft:#e3edf5;--pass:#2b8a5a;--cap:#3a7d9c;--fric:#b8800f;--block:#c33d2a;--na:#9aa09b;--code:#eef0ed}
@media (prefers-color-scheme:dark){:root{--bg:#151716;--card:#1d201f;--fg:#e8eae7;--muted:#9ea49f;--line:#343936;--accent:#6fb0dd;--accent-soft:#1f2c36;--pass:#5ccf8f;--cap:#7cbbd8;--fric:#e0b04a;--block:#f07a66;--na:#6c726d;--code:#242826}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;padding:28px 16px 64px}
.wrap{max-width:800px;margin:0 auto}
.stripe{height:3px;background:var(--accent);border-radius:2px}
header{padding:22px 0 8px}
.tag-line{font:600 11px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font-size:18px;font-weight:600;margin:8px 0 18px;text-wrap:balance}
h1 code{font-family:ui-monospace,monospace}
h2{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:30px 0 10px;padding-top:14px;border-top:1px solid var(--line)}
h2.warn-h{color:var(--block)}
.hero{display:flex;gap:40px;flex-wrap:wrap;align-items:flex-end}
.big{font-variant-numeric:tabular-nums;font-size:56px;font-weight:750;letter-spacing:-.02em;line-height:1}
.big small{display:block;font-size:13px;font-weight:500;color:var(--muted);letter-spacing:0;margin-top:6px}
.delta{font-size:13px;font-weight:600;margin-top:4px}.delta.up{color:var(--pass)}.delta.down{color:var(--block)}
.stall{margin-top:16px;font-size:16px;max-width:60ch}.stall b{color:var(--block)}
.level{font-size:13px;color:var(--muted);margin-top:4px}
blockquote{border-left:3px solid var(--accent);margin:14px 0 0;padding:4px 0 4px 14px;font-size:15px;max-width:62ch}
blockquote cite{display:block;font-style:normal;font-size:12px;color:var(--muted);margin-top:4px}
.rail{margin-top:22px;border-top:1px solid var(--line);padding-top:12px}
.row{display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center;margin:6px 0}
.row .lbl{font:600 11px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.steps{display:flex;flex-wrap:wrap;gap:6px}
.step{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:3px 10px 3px 6px;font-size:12.5px;background:var(--card)}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.dot.ghost{opacity:.35;margin-right:-4px}
.d-pass{background:var(--pass)}.d-cap{background:var(--cap)}.d-fric{background:var(--fric)}.d-block{background:var(--block)}.d-na{background:transparent;border:2px solid var(--na);width:8px;height:8px}
.legend{font-size:12px;color:var(--muted);margin-top:10px;display:flex;gap:14px;flex-wrap:wrap}.legend span{display:inline-flex;align-items:center;gap:5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:12px 0}
.card.blocked{border-left:3px solid var(--block)}.card.friction{border-left:3px solid var(--fric)}
.card-h{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px}.card-h .state{margin-left:auto;font:600 11px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.triad{display:grid;gap:8px;margin-top:12px;font-size:13.5px}.triad b{display:block;font:600 11px/1.6 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.pill{font:600 11px/1 ui-monospace,monospace;background:var(--accent-soft);color:var(--accent);padding:3px 7px;border-radius:999px}
.ref{font-size:12px;color:var(--muted)}
.card img{display:block;max-width:520px;width:100%;max-height:340px;object-fit:contain;object-position:left top;margin:12px 0 0;border:1px solid var(--line);border-radius:6px;background:var(--code)}
details{margin-top:10px;font-size:13px}summary{cursor:pointer;color:var(--muted)}
pre{background:var(--code);padding:10px 12px;border-radius:6px;font-size:12.5px;overflow-x:auto;margin-top:6px;white-space:pre-wrap}
code{font-family:ui-monospace,monospace;font-size:12.5px}
.ev{padding-left:18px;margin-top:6px}.ev li{margin:3px 0}
.vote{font:600 10px/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:999px;color:#fff;background:var(--na)}
.vote.d-pass{background:var(--pass)}.vote.d-cap{background:var(--cap)}.vote.d-fric{background:var(--fric)}.vote.d-block{background:var(--block)}
details.bench{margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
details.bench summary{font-size:13px}
details.bench table{margin-top:8px}
.saw{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.saw figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}
.saw img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:4px}
.saw figcaption{font-size:12px;color:var(--muted);margin-top:6px;display:flex;gap:6px;align-items:flex-start;line-height:1.4}
.fixed{padding-left:0;list-style:none}.fixed li{margin:6px 0;font-size:14px}
.tag{display:inline-block;font:600 10px/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;padding:4px 8px;border-radius:999px;color:#fff}
.t-was{background:var(--block)}.t-now{background:var(--pass)}
.ba-stage{font:600 12px ui-monospace,monospace;min-width:80px}
.ba{display:flex;gap:10px;align-items:center;margin:6px 0;font-size:14px;flex-wrap:wrap}.ba .arrow{color:var(--muted)}
.tbl{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font:600 11px/1.3 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px;border-bottom:1px solid var(--line)}
td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
td:first-child{white-space:nowrap;font:600 12.5px ui-monospace,monospace}
.sev-high{color:var(--block)}.sev-med{color:var(--fric)}.sev-low{color:var(--muted)}.sev-plus{color:var(--pass)}
footer{color:var(--muted);font-size:12.5px;padding:24px 0 8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
@media (max-width:640px){.big{font-size:42px}.row{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
  <div class="stripe"></div>
  <header>
    <div class="tag-line">agent-ready · ${esc(shortDate(report.generatedAt))}${d ? ` · vs ${esc(previousLabel || shortDate(d.previousAt))}` : ""} · ${esc(report.providersRun.join(" + "))}</div>
    <h1><code>${esc(host)}</code> × task: “${esc(report.task || "unspecified")}”</h1>
    <div class="hero">
      <div class="big">${h.cleared} / ${h.of}<small>stages cleared unassisted</small>${deltaCleared}</div>
      ${hi !== null ? `<div class="big">${hi}<small>human interventions</small>${deltaHi}</div>` : ""}
    </div>
    <div class="stall">${stalled ? (stalled.state === "NOT_TESTED" ? `Not tested past <b>${esc(stalled.id)}</b>.` : `Stalled at <b>${esc(stalled.id)}</b>${stalledEvidence ? `: ${esc(stalledEvidence.note)}` : "."}`) : "Every claimed stage cleared."}</div>
    <div class="level">Level ${report.maturity.level} · ${esc(report.maturity.label)} · ${esc(report.maturity.reason)}${report.devReadiness.score !== null ? ` · dev readiness ${report.devReadiness.score}/10` : ""}</div>
    ${stalledQuote ? `<blockquote>${esc(stalledQuote)}<cite>the agent, at ${esc(stalled.id)}</cite></blockquote>` : ""}
    <div class="rail">${rail}
      <div class="legend"><span><i class="dot d-pass"></i>verified</span><span><i class="dot d-cap"></i>capable</span><span><i class="dot d-fric"></i>human required</span><span><i class="dot d-block"></i>blocked</span><span><i class="dot d-na"></i>not tested / n/a</span></div>
    </div>
  </header>

  ${first ? `<h2>Fix this first</h2>
  <div class="card blocked">
    <div class="card-h"><span class="stage">${esc(first.stage)}</span><span class="state">${esc(SEV_LABEL[first.severity])}</span></div>
    <p style="margin-top:8px;font-weight:600">${esc(first.text)}</p>
    ${first.fix ? `<p style="margin-top:6px;font-size:14px">Build: ${esc(first.fix)}</p>` : ""}
    ${first.command || first.docLine ? `<p style="margin-top:6px"><code>${esc(first.command || "")}</code>${first.docLine ? ` <span class="ref">${esc(first.docLine)}</span>` : ""}</p>` : ""}
    ${firstShot ? `<img alt="${esc(first.stage)} screenshot" src="${firstShot}">` : ""}
  </div>` : ""}

  ${nonPass.length ? `<h2>Where it stops</h2>\n${cards}` : ""}

  ${sawBlock}

  ${fixedBlock}
  ${regressedBlock}

  <h2>Findings</h2>
  <div class="tbl"><table>
    <tr><th>Grade</th><th>Stage</th><th>Finding</th><th>Source line / request</th><th>Fix</th></tr>
    ${rows || `<tr><td colspan="5">No findings.</td></tr>`}
  </table></div>
  ${benchBlock}

  <footer><span>${esc(sourcesLine)}${report.sources.crash ? ` · persona: ${esc(report.sources.crash.persona)}` : ""}</span><span>run ${esc(report.runId)} · report.json · report.md</span></footer>
  <div class="stripe"></div>
</div>
</body>
</html>
`;
}
