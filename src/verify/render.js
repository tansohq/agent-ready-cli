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
  const out = ["", `  ${style.bold("agent-ready verify")} · ${host}`, ...wrap(`Task: ${task}`, 76).map((l) => `  ${style.dim(l)}`), ""];
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

// `verify --check`: what a run would do, in the same row layout, so the one paid run holds no surprises.
export function renderPlan(plan, style) {
  const out = ["", `  ${style.bold("agent-ready verify --check")} · ${plan.target.host}`, ...wrap(`Task: ${plan.task}`, 76).map((l) => `  ${style.dim(l)}`), ""];
  const row = (pass, label, detail) => {
    const [first = "", ...rest] = wrap(detail, 80 - 23);
    out.push(`  ${mark(pass, style)} ${label.padEnd(18)} ${first}`);
    for (const line of rest) out.push(`${" ".repeat(23)}${line}`);
  };
  row(plan.claudeCode.ok, "Claude Code", plan.claudeCode.detail);
  row(null, "Agent may reach", plan.agent.hosts.join(", "));
  row(null, "Inbox", plan.agent.inbox);
  row(null, "Agent saves", `${plan.agent.saves.join(" and ")} in work/CREDENTIAL.env (the harness asks for them; the task need not)`);
  row(null, "Checker calls", plan.checker.call);
  for (const c of plan.checker.calls) row(null, "", c);
  out.push("");
  if (plan.ready) out.push(`  ${style.bold(style.green("READY"))}  Nothing ran. Start the agent with ${style.bold("npx @tansohq/agent-ready verify")}`);
  else out.push(`  ${style.bold(style.red("NOT READY"))}  ${plan.claudeCode.hint}`);
  out.push(`  ${style.dim("A host the agent needs is missing? Add it to verify_hosts in agent-ready.yml.")}`, "");
  return out;
}
