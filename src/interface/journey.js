import { runId as newRunId } from "../schema/ids.js";

// A task-driven journey over an interface document. Rule-based and conservative: each stage succeeds only when the
// evidence in the document supports it, names the observations it used, and fails with the gap in plain words.
// Stages that need credentials or a live call are reported not_run, never simulated.

export const JOURNEY_SCHEMA = "agent-ready/journey@1";
export const JOURNEY_STAGES = ["discover", "understand", "choose_interface", "acquire_credential", "authenticate", "execute", "recover"];

const STOP = new Set("a an and the to into for from with of on in my our your this that it is are be app application product service using use via how do i can".split(" "));
const GENERIC = new Set("integrate integration connect setup set configure configuration implement start started getting api mcp cli server".split(" "));

// The product's own name is not a task term: "Integrate Stripe" would match every capability that says Stripe.
function taskTerms(task, productName) {
  const name = new Set(String(productName || "").toLowerCase().split(/\s+/));
  return [...new Set(String(task).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !name.has(w)))];
}

function stage(name, status, reason, basedOn = [], extra = {}) {
  return { stage: name, status, success: status === "success", reason, basedOn: [...new Set(basedOn.filter(Boolean))], ...extra };
}

export function runJourney(doc, task, { runId = newRunId(), generatedAt = new Date().toISOString() } = {}) {
  const obs = doc.observations;
  const ok = (role) => obs.filter((o) => o.ok && o.role === role);
  const terms = taskTerms(task, doc.product.name?.value);
  const specificTerms = terms.filter((t) => !GENERIC.has(t));
  const stages = [];

  // discover: the product can be reached and there is something written for a machine to start from.
  const home = obs.find((o) => o.role === "homepage");
  const entry = [...ok("llms_txt"), ...ok("agent_json"), ...ok("docs"), ...ok("api_docs")];
  if (!home?.ok) stages.push(stage("discover", "failed", `homepage ${home?.status || home?.error || "not fetched"}`, [home?.id]));
  else if (!entry.length) stages.push(stage("discover", "failed", "homepage reachable but no llms.txt, agent.json or docs page was found to start from", [home.id]));
  else stages.push(stage("discover", "success", `homepage reachable; entry points for an agent: ${[...new Set(entry.map((o) => o.role))].join(", ")}`, [home.id, ...entry.map((o) => o.id)]));

  // understand: something machine-derived says what the product does, and the task maps onto it.
  const caps = doc.capabilities;
  const matched = caps.filter((c) => {
    const details = (c.operationDetails || []).map((o) => `${o.summary || ""} ${o.description || ""} ${o.operationId || ""}`).join(" ");
    const hay = `${c.name} ${c.description || ""} ${c.operations.join(" ")} ${details}`.toLowerCase();
    return specificTerms.some((t) => hay.includes(t));
  });
  const capObs = caps.flatMap((c) => c.evidence.map((e) => e.obs));
  const suggestions = caps.slice(0, 4).map((c) => c.name);
  if (!specificTerms.length) stages.push(stage("understand", "needs_input", "Choose a specific action to check. A general request to integrate a product does not say what the agent should accomplish.", capObs, { suggestions }));
  else if (!caps.length) stages.push(stage("understand", "unknown", "No capabilities could be extracted from the public sources read. This does not establish whether an agent can complete the task.", [doc.product.description?.evidence?.[0]?.obs], { suggestions }));
  else if (!matched.length) stages.push(stage("understand", "unknown", "The task could not be matched to the extracted documentation. An agent has not attempted it; try a documented action or review the sources.", capObs, { capabilities: caps.map((c) => c.name), suggestions }));
  else stages.push(stage("understand", "success", `Task terms appear in the documentation for: ${matched.map((c) => c.name).slice(0, 6).join(", ")}. Completion has not been tested.`, matched.flatMap((c) => c.evidence.map((e) => e.obs)), { matchedCapabilities: matched.map((c) => c.name) }));

  // choose_interface: the task names one, else prefer API > MCP > CLI. Chosen interface must be documented.
  const i = doc.interfaces;
  const wanted = terms.includes("mcp") ? "mcp" : terms.includes("cli") ? "cli" : null;
  const order = wanted ? [wanted, "api", "mcp", "cli"] : ["api", "mcp", "cli"];
  const chosen = order.find((k) => ["yes", "partial"].includes(i[k].exists.verdict));
  if (!chosen) stages.push(stage("choose_interface", "failed", "no API, MCP or CLI interface was found on first-party surfaces", ["api", "mcp", "cli"].flatMap((k) => i[k].exists.basedOn)));
  else if (wanted && chosen !== wanted) stages.push(stage("choose_interface", "failed", `task asks for ${wanted}; it was not found (${i[wanted].exists.reason}); ${chosen} exists instead`, [...i[wanted].exists.basedOn, ...i[chosen].exists.basedOn], { chosen: null }));
  else stages.push(stage("choose_interface", "success", `${chosen}: ${i[chosen].exists.reason}${i[chosen].exists.verdict === "partial" ? " (documented in prose only; no machine-readable spec)" : ""}`, i[chosen].exists.basedOn, { chosen, specified: i[chosen].exists.verdict === "yes" }));

  // acquire_credential: can an agent get its own key? The interface document does not inspect signup surfaces, so
  // there is no rule here yet; the harness measures it by having the agent try.
  stages.push(stage("acquire_credential", "not_run", "no rule over the interface document; measured by the execution harness (signup mode)"));

  // authenticate: we need to know how, from evidence, before an agent could try.
  const auth = doc.authentication;
  const setup = auth.agentCanUnderstandSetup;
  if (chosen !== "api") stages.push(stage("authenticate", "unknown", chosen ? `Authentication for the ${chosen.toUpperCase()} interface has not been established. The OpenAPI authentication evidence applies to the API only.` : "Choose a documented interface before assessing its authentication requirements.", setup.basedOn));
  else if (setup.verdict === "yes") stages.push(stage("authenticate", "success", `${setup.reason} No authenticated or anonymous task call was made.`, setup.basedOn, { methods: auth.methods.map((m) => m.type) }));
  else stages.push(stage("authenticate", "unknown", `${setup.reason} Access has not been tested live.`, [...setup.basedOn, ...auth.mentions.flatMap((m) => m.evidence.map((e) => e.obs))]));

  stages.push(stage("execute", "not_run", "Public inspection does not execute tasks. An agent usability run is needed to test completion."));
  stages.push(stage("recover", "not_run", "Recovery can only be evaluated during an agent usability run."));

  const failed = stages.find((s) => s.status === "failed");
  const unresolved = stages.filter((s) => ["unknown", "needs_input"].includes(s.status)).map((s) => ({ stage: s.stage, status: s.status, reason: s.reason, basedOn: s.basedOn, suggestions: s.suggestions || [] }));
  const reached = stages.filter((s) => s.status === "success").length;
  return {
    schema: JOURNEY_SCHEMA,
    generator: { ...doc.generator, runId },
    generatedAt,
    target: doc.target,
    task,
    taskTerms: terms,
    interfaceRunId: doc.generator.runId,
    method: "rule",
    stages,
    reached: { count: reached, of: stages.filter((s) => s.status !== "not_run").length, stoppedAt: failed?.stage ?? null },
    failure: failed ? { stage: failed.stage, reason: failed.reason, basedOn: failed.basedOn } : null,
    unresolved,
    notRun: stages.filter((s) => s.status === "not_run").map((s) => s.stage),
    limits: ["stages are decided by named rules over the interface document, not by an agent attempting the task", "execute and recover are not run", ...doc.limits],
  };
}
