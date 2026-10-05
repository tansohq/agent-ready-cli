import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as claudePrint from "./executors/claude-print.js";
import { personaInstructions } from "./persona.js";

// Executor interface. Any replacement (Agent SDK, another agent) implements:
//   name: string
//   run({ prompt, workDir, childEnv, tools, network, maxTurns, model, redact, learn, onEvent }) → {
//     executor: { name, model, maxTurns, tools, confinement }, startedAt, finishedAt, exitCode,
//     stoppedBecause, turns, costUsd, stderr, rawTrace }
// and emits normalized events through onEvent:
//   { kind: "text", text } | { kind: "tool_use", tool, input } | { kind: "tool_result", error, denied, text } |
//   { kind: "result", subtype, turns, costUsd, durationMs }
// The executor is never asked whether it succeeded. Everything it emits is already redacted.

export const EXECUTORS = { [claudePrint.name]: claudePrint };
export const EXECUTOR_TOOLS = ["Bash", "WebFetch", "Read", "Write", "Edit", "Glob", "Grep"];

// The agent sees the observed surface only: which first-party pages exist. Never the extractor's verdicts, so it
// cannot be primed toward the weakness the extractor named. The three artifacts stay independent until reconcile.
export function evidenceFor(doc) {
  return {
    product: { name: doc.product.name?.value ?? null, description: doc.product.description?.value ?? null, url: doc.target.url },
    pages: doc.observations.filter((o) => o.ok).map((o) => ({ id: o.id, role: o.role, url: o.url, contentType: o.contentType })),
  };
}

export function buildPrompt({ task, runId, doc, credentials, mode = credentials.available.length ? "given" : "none", persona = null }) {
  const ev = evidenceFor(doc);
  const cited = ev.pages.map((o) => `- ${o.url}`).join("\n");
  const modeLines = mode === "given" ? task.instructions.withCredential : mode === "signup" ? task.instructions.signup : task.instructions.withoutCredential;
  const personaLines = persona ? personaInstructions(persona) : [];
  return [
    `Task: ${task.text}`,
    ``,
    `Product: ${ev.product.name || doc.target.host} (${doc.target.url}). Run id: ${runId}.`,
    ``,
    `First-party pages known to exist for this product (also listed in evidence.json here):`,
    cited,
    ``,
    `You may fetch any of those pages and anything they link to on: ${task.network.join(", ")}. Other hosts are blocked. Prefer first-party documentation over memory.`,
    ``,
    ...[...task.instructions.always, ...modeLines, ...personaLines].map((s) => `- ${s.replace("<runId>", runId)}`),
  ].join("\n");
}

// A key the agent obtained itself lives in CREDENTIAL.env for the evaluator. Once read, its value joins the
// redactor so a second scrub removes it from the trace, the files and this summary.
function acquiredKeyValue(workDir, envName) {
  const p = join(workDir, "CREDENTIAL.env");
  if (!existsSync(p)) return null;
  return (readFileSync(p, "utf8").match(new RegExp(`${envName}=([^\\s]+)`)) || [])[1] || null;
}

// Every value in CREDENTIAL.env is a secret to the redactor, not only the primary one (account ids, assertions).
function acquiredValues(workDir) {
  const p = join(workDir, "CREDENTIAL.env");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"\s]{8,})"?/)).filter(Boolean).map((m) => m[1]);
}

// Every URL the agent reached for, whether through WebFetch or a command. Learned from the first real trace: the
// agent read every doc with curl and never touched WebFetch.
export function sourcesFrom(events) {
  const urls = [];
  for (const e of events) {
    if (e.kind !== "tool_use") continue;
    if (e.tool === "WebFetch" && e.input) urls.push(e.input);
    if (e.tool === "Bash") for (const m of String(e.input).matchAll(/https?:\/\/[^\s"'`)|;<>]+/g)) urls.push(m[0]);
  }
  return [...new Set(urls)];
}

// Agent-written files are part of the record but not part of the trace boundary: scrub them after the run so a key
// the agent copied into a file never persists. The scrub is recorded.
function scrubWorkDir(workDir, redact) {
  const scrubbed = [];
  for (const name of readdirSync(workDir)) {
    const p = join(workDir, name);
    // CREDENTIAL.env is read raw by the evaluator and overwritten by the harness afterwards; never scrub it here.
    if (name === "CREDENTIAL.env" || !statSync(p).isFile() || /\.(png|jpg|gz|zip|bin)$/i.test(name)) continue;
    const before = readFileSync(p, "utf8");
    const after = redact(before);
    if (after !== before) {
      writeFileSync(p, after);
      scrubbed.push(name);
    }
  }
  return scrubbed;
}

export async function execute({ task, runId, doc, workDir, credentials, mode, persona = null, executorName = claudePrint.name, maxTurns = 40, model = null, afterRun = async () => ({}), log = () => {} }) {
  const executor = EXECUTORS[executorName];
  if (!executor) throw new Error(`unknown executor ${executorName}; known: ${Object.keys(EXECUTORS).join(", ")}`);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(join(workDir, "inbox"), { recursive: true });
  writeFileSync(join(workDir, "evidence.json"), JSON.stringify(evidenceFor(doc), null, 2));
  const prompt = buildPrompt({ task, runId, doc, credentials, mode, persona });
  writeFileSync(join(workDir, "prompt.md"), prompt);

  const events = [];
  const onEvent = (e) => {
    const entry = { at: new Date().toISOString(), seq: events.length + 1, ...e };
    events.push(entry);
    log(entry);
  };
  const run = await executor.run({ prompt, workDir, childEnv: credentials.childEnv, tools: EXECUTOR_TOOLS, network: task.network, maxTurns, model, redact: credentials.redact, learn: credentials.learn, onEvent });
  const extra = await afterRun();

  // If the agent acquired a key, learn its value now so everything written from here on is scrubbed of it.
  const acquired = acquiredKeyValue(workDir, task.credentialEnvName || "STRIPE_API_KEY");
  if (acquired) credentials.learn(acquired);
  for (const v of acquiredValues(workDir)) credentials.learn(v);
  // trace.jsonl was written live, before the acquired value was known: scrub it again now.
  const scrubbed = scrubWorkDir(workDir, credentials.redact);
  for (const e of events) for (const k of ["text", "input"]) if (typeof e[k] === "string") e[k] = credentials.redact(e[k]);
  const readFile = (name) => (existsSync(join(workDir, name)) ? credentials.redact(readFileSync(join(workDir, name), "utf8")) : null);
  const toolUses = events.filter((e) => e.kind === "tool_use");
  const summary = {
    ...run,
    task: { id: task.id, apiHost: task.apiHost || null, credentialEnvName: task.credentialEnvName || null },
    mode,
    persona: persona ? { name: persona.name, email: persona.email, company: persona.company } : null,
    ...extra,
    credentials: { available: credentials.available, missing: credentials.missing, rejected: credentials.rejected, acquiredByAgent: Boolean(acquired), scrubbedFiles: scrubbed },
    turns: run.turns,
    durationMs: new Date(run.finishedAt) - new Date(run.startedAt),
    toolCalls: toolUses.length,
    sources: sourcesFrom(events),
    commands: toolUses.filter((e) => e.tool === "Bash").map((e) => e.input),
    // Walls the agent met, read from tool output rather than from the agent's words.
    signals: {
      captcha: (() => {
        const hit = events.find((e) => e.kind === "tool_result" && /hcaptcha|recaptcha|turnstile|arkose|captcha_frontend_enabled/i.test(e.text));
        return hit ? `${(hit.text.match(/hcaptcha|recaptcha|turnstile|arkose/i) || ["captcha"])[0].toLowerCase()} at seq ${hit.seq}` : null;
      })(),
      serverErrors: events.filter((e) => e.kind === "tool_result" && /\b50[0-9]\b|Service Unavailable|Bad Gateway/i.test(e.text.slice(0, 600))).length,
      // The agent could not open a connection at all: the test environment, not the product (a sandbox that blocks
      // localhost did this to a loop run on a local sample product).
      connectionFailures: events.filter((e) => e.kind === "tool_result" && /Failed to connect|Connection refused|ECONNREFUSED|Could not resolve host|ENOTFOUND|Couldn't connect to server/i.test(e.text)).length,
      sandboxEscapeAttempts: events.filter((e) => e.kind === "tool_result" && /Run outside of the sandbox/i.test(e.text)).length,
      browserUsed: events.some((e) => e.kind === "tool_use" && e.tool === "Bash" && /agent-browser|playwright|chromium|puppeteer/i.test(e.input)),
    },
    errors: events.filter((e) => e.kind === "tool_result" && e.error).map((e) => ({ seq: e.seq, text: e.text.slice(0, 200) })),
    denied: events.filter((e) => e.kind === "tool_result" && e.denied).length,
    // A recovery attempt is any tool call that follows an error before the run ends.
    recoveryAttempts: events.filter((e, i) => e.kind === "tool_use" && events.slice(0, i).some((p) => p.kind === "tool_result" && p.error)).length,
    files: { plan: readFile("PLAN.md"), needsCredential: readFile("NEEDS_CREDENTIAL.md"), needsHuman: readFile("NEEDS_HUMAN.md"), request: readFile("request.sh"), credentialFile: existsSync(join(workDir, "CREDENTIAL.env")) },
    events,
  };
  writeFileSync(join(workDir, "execution.json"), JSON.stringify(summary, null, 2));
  return summary;
}
