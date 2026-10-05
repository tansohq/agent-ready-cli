import { wrap } from "../audit/render.js";

// Terminal output for `agent-ready verify`, in the same layout as audit: one row per check, the result after.

const OUTCOME = { passed: "PASS", handoff: "PASS (handoff)", failed: "FAIL", inconclusive: "INCONCLUSIVE" };

function mark(pass, style) {
  if (pass === true) return style.green("✓");
  if (pass === false) return style.red("✗");
  return style.dim("·");
}

export function verifyRows(result) {
  const evaluation = result.evaluation || {};
  const acquired = (evaluation.checks || []).find((c) => c.id === "credential_acquired");
  const rows = [{ label: "Got a key", pass: acquired ? acquired.pass : false, detail: acquired ? (acquired.pass ? "the agent got its own key; redacted from every file" : acquired.detail) : "no key" }];
  const checks = evaluation.objects?.checks || [];
  if (checks.length) for (const c of checks) rows.push({ label: c.label, pass: c.pass, detail: c.detail });
  else rows.push({ label: "Key works", pass: null, detail: "not checked: no key to try" });
  return rows;
}

export function renderVerify({ host, task, result, verdict, folder, promptFile }, style) {
  const out = ["", `  ${style.bold("agent-ready verify")} · ${host}`, `  ${style.dim(`Task: ${task}`)}`, ""];
  // Same width rule as audit: every line fits 80 columns, continuation lines indented under the detail.
  for (const r of verifyRows(result)) {
    const [first = "", ...rest] = wrap(r.detail, 80 - 23);
    out.push(`  ${mark(r.pass, style)} ${r.label.padEnd(18)} ${first}`);
    for (const line of rest) out.push(`${" ".repeat(23)}${line}`);
  }
  const paint = verdict.outcome === "passed" || verdict.outcome === "handoff" ? style.green : verdict.outcome === "failed" ? style.red : (s) => s;
  out.push("", `  ${style.bold(paint(OUTCOME[verdict.outcome]))}  ${verdict.reason}`);
  const execution = result.execution || {};
  const cost = typeof execution.costUsd === "number" ? ` · $${execution.costUsd.toFixed(2)}` : "";
  out.push(`  ${style.dim(`${execution.turns ?? "?"} turns${cost} · evidence in ${folder}/`)}`);
  if (promptFile) out.push("", `  ${style.bold("Next")}  paste ${promptFile} into your coding agent,`, `        then run ${style.bold("npx @tansohq/agent-ready verify")} again`);
  out.push("");
  return out;
}
