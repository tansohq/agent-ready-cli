export const SCHEMA_ID = "agent-ready/interface@1";
const VERDICTS = ["yes", "partial", "no", "unknown"];

// Field-level documentation served at GET /v1/schema so another agent can read the shape without the dashboard.
export const SCHEMA_DOC = {
  schema: SCHEMA_ID,
  conventions: {
    observation: "One HTTP fetch: id, role, url, status, contentType, bytes, sha256, fetchedAt, discoveredVia (well_known | link from another observation | sitemap), excerpt. Never judged.",
    fact: "{ value, method: 'extracted', evidence: [{ obs, quote }] }. Deterministically pulled from an observation. null when not found.",
    evaluation: "{ verdict: yes|partial|no|unknown, reason, rule, basedOn: [obs ids], method: 'rule' }. A named rule applied to facts. unknown = not enough observed.",
    interpretation: "Not present in this version. No model-generated text is included; every string is either fetched or produced by a named rule.",
  },
  fields: {
    generator: "tool name, version, and the run id",
    target: "url and host that was inspected",
    startedAt_finishedAt: "ISO timestamps for the run; each observation has its own fetchedAt",
    product: "name, description, category as facts or null",
    observations: "every fetch made, in order",
    interfaces: "website, api, mcp, cli: existence and discoverability as evaluations",
    capabilities: "derived from OpenAPI tags, untagged operation summaries/IDs, or llms.txt sections; each with evidence and, for OpenAPI, operationDetails preserving summaries and descriptions",
    authentication: "methods declared in securitySchemes (not necessarily used), separate text mentions, requirement, agentCanUnderstandSetup, friction; none of these establishes live access",
    authentication_requirement: "{ value: none|required|mixed|not_declared|unknown, reason, basedOn, rule, operations: [{ operation, value, reason, basedOn, rule, source: operation|global|absent, schemeNames }] }; operation security overrides global security; none requires an explicit operation [] or anonymous {} alternative; absent or empty global security is not_declared; unresolved declarations or incomplete operation coverage are unknown",
    pricing: "model, plans, observedPrices, agentCanDetermineCost, ambiguities",
    machineAccess: "robots, llms.txt, agent.json facts plus aiCrawlersAllowed, hasAgentReadableIndex and agentAuthDiscoverable",
    onboarding: "{ patterns: [{ id: try_then_claim|limited_until_claimed|agent_is_customer|agent_identity|existing_account|pay_per_request, name, status: documented|inferred, reason, evidence: [{ obs, quote }], humanBoundary, needs: [inbox|cli|wallet|agent_identity] }], apiHosts: [{ domain, host, example, evidence }], primary, reason }. apiHosts are API URLs on other domains that the product's agent-facing pages point to. Ways an agent can start, as the public docs describe them; needs lists what testing that way end to end requires beyond HTTP requests, which a given deployment may or may not provide. A pattern is a documented claim, never a result.",
    funnel: "{ headline, passed, of, stopsAt, path, paths, steps: [{ id: discover|understand|signup|access|pay|use|manage, name, area: web|onboarding|monetization, question, state: agent_did|agent_can|handoff|needs_person|blocked|not_checked, reason, fix?, basedOn, live? }], fixes }. The seven steps an agent takes, from public evidence only. handoff means a person steps in at a documented point and the agent carries on, which counts as passing. agent_did appears only when the latest live test for that step on this product passed; a blocked live test sets blocked. live names that test.",
    unknowns: "every field whose verdict is unknown or whose fact is null, with the reason",
    limits: "what this run could not do (no JS rendering, no login, no model interpretation)",
  },
};

class ValidationError extends Error {
  constructor(problems) {
    super(`interface.json invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "ValidationError";
    this.problems = problems;
  }
}

function checkEval(e, path, problems) {
  if (!e || typeof e !== "object") return problems.push(`${path} missing`);
  if (!VERDICTS.includes(e.verdict)) problems.push(`${path}.verdict invalid: ${e.verdict}`);
  if (typeof e.reason !== "string") problems.push(`${path}.reason missing`);
  if (!Array.isArray(e.basedOn)) problems.push(`${path}.basedOn must be an array`);
}

function checkFact(f, path, problems) {
  if (f === null) return;
  if (!f || typeof f !== "object" || !("value" in f)) return problems.push(`${path} must be a fact or null`);
  if (!Array.isArray(f.evidence) || !f.evidence.length) problems.push(`${path}.evidence must be a non-empty array`);
}

export function validateInterface(doc) {
  const problems = [];
  if (!doc || typeof doc !== "object") throw new ValidationError(["document is not an object"]);
  if (doc.schema !== SCHEMA_ID) problems.push(`schema must be ${SCHEMA_ID}`);
  if (!doc.generator?.name || !doc.generator?.version || !doc.generator?.runId) problems.push("generator.name, version, runId required");
  if (!doc.target?.url) problems.push("target.url required");
  if (typeof doc.startedAt !== "string" || typeof doc.finishedAt !== "string") problems.push("startedAt and finishedAt required");
  if (!Array.isArray(doc.observations)) problems.push("observations must be an array");
  else {
    const ids = new Set(doc.observations.map((o) => o.id));
    doc.observations.forEach((o, i) => {
      for (const k of ["id", "role", "url", "fetchedAt"]) if (typeof o[k] !== "string") problems.push(`observations[${i}].${k} missing`);
      if (!Number.isInteger(o.status)) problems.push(`observations[${i}].status missing`);
      if (!o.discoveredVia?.kind) problems.push(`observations[${i}].discoveredVia.kind missing`);
    });
    const walk = (node, path) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.basedOn)) for (const id of node.basedOn) if (!ids.has(id)) problems.push(`${path}.basedOn references unknown ${id}`);
      if (Array.isArray(node.evidence)) for (const e of node.evidence) if (!ids.has(e.obs)) problems.push(`${path}.evidence references unknown ${e.obs}`);
      for (const [k, v] of Object.entries(node)) if (k !== "observations") walk(v, `${path}.${k}`);
    };
    walk(doc, "doc");
  }
  for (const k of ["name", "description", "category"]) checkFact(doc.product?.[k], `product.${k}`, problems);
  for (const i of ["website", "api", "mcp", "cli"]) checkEval(doc.interfaces?.[i]?.exists, `interfaces.${i}.exists`, problems);
  checkEval(doc.authentication?.agentCanUnderstandSetup, "authentication.agentCanUnderstandSetup", problems);
  if (doc.authentication?.requirement) {
    const states = ["none", "required", "mixed", "not_declared", "unknown"];
    const requirement = doc.authentication.requirement;
    if (!states.includes(requirement.value)) problems.push("authentication.requirement.value invalid");
    if (typeof requirement.reason !== "string" || !Array.isArray(requirement.basedOn)) problems.push("authentication.requirement requires reason and basedOn");
    if (!Array.isArray(requirement.operations)) problems.push("authentication.requirement.operations must be an array");
    else for (const operation of requirement.operations) if (!operation || typeof operation.operation !== "string" || !states.includes(operation.value)) problems.push("authentication.requirement operation invalid");
  }
  checkEval(doc.pricing?.agentCanDetermineCost, "pricing.agentCanDetermineCost", problems);
  checkEval(doc.machineAccess?.aiCrawlersAllowed, "machineAccess.aiCrawlersAllowed", problems);
  if (doc.onboarding !== undefined) {
    const ids = ["try_then_claim", "limited_until_claimed", "agent_is_customer", "agent_identity", "existing_account", "pay_per_request"];
    if (!Array.isArray(doc.onboarding?.patterns)) problems.push("onboarding.patterns must be an array");
    else for (const p of doc.onboarding.patterns) if (!ids.includes(p?.id) || !["documented", "inferred"].includes(p?.status) || !Array.isArray(p?.needs)) problems.push(`onboarding pattern invalid: ${p?.id}`);
  }
  if (!Array.isArray(doc.capabilities)) problems.push("capabilities must be an array");
  if (!Array.isArray(doc.unknowns)) problems.push("unknowns must be an array");
  if (problems.length) throw new ValidationError(problems);
  return doc;
}

export { ValidationError };
