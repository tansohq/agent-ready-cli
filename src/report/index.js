import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { merge } from "./merge.js";
import { historyLine } from "./delta.js";
import { renderHtml } from "./html.js";
import { renderMarkdown } from "./md.js";
import { validateScan, validateAudit, validateCrash } from "../schema/validate.js";
import { runId as newRunId } from "../schema/ids.js";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Load whatever provider files exist in a run directory.
export function loadRunDir(dir) {
  const pick = (name, validate) => {
    const p = join(dir, `${name}.json`);
    return existsSync(p) ? validate(readJson(p)) : null;
  };
  const scan = pick("scan", validateScan);
  const audit = pick("audit", validateAudit);
  const crash = pick("crash", validateCrash);
  const runFile = join(dir, "run.json");
  const run = existsSync(runFile) ? readJson(runFile) : {};
  return { scan, audit, crash, run };
}

// Build a report from a run directory. previous = history lines (oldest first) or a directory holding an earlier run.
export function buildReport({ dir, previous = [], version, task, claims }) {
  const { scan, audit, crash, run } = loadRunDir(dir);
  if (!scan && !audit && !crash) throw new Error(`no scan.json, audit.json or crash.json in ${dir}`);
  const any = scan || audit || crash;
  return merge({
    scan,
    audit,
    crash,
    task: task ?? run.task ?? crash?.task ?? "",
    claims: claims ?? run.claims,
    previous,
    runId: any.runId || newRunId(),
    target: any.target,
    version,
  });
}

export function previousFromDir(dir, version) {
  const report = buildReport({ dir, version });
  return [historyLine(report)];
}

export function writeReport(report, outDir, { assetDir, previousLabel } = {}) {
  mkdirSync(outDir, { recursive: true });
  const paths = {
    json: join(outDir, "report.json"),
    html: join(outDir, "report.html"),
    md: join(outDir, "report.md"),
  };
  writeFileSync(paths.json, JSON.stringify(report, null, 2));
  writeFileSync(paths.html, renderHtml(report, { assetDir, previousLabel }));
  writeFileSync(paths.md, renderMarkdown(report, { previousLabel }));
  return paths;
}
