// The one order of the seven steps, everywhere: the funnel, the dashboard, the CLI's check, the older report,
// the docs and auth.md. An agent uses a product before it pays: in every passing live run the agent made real
// calls on a free key, and payment came at a limit or when a person claimed the account.
export const STAGES = ["discover", "understand", "signup", "access", "use", "pay", "manage"];

export const PILLAR = {
  discover: "web",
  understand: "web",
  signup: "onboarding",
  access: "onboarding",
  pay: "monetization",
  use: "monetization",
  manage: "monetization",
};

export const PILLARS = ["web", "onboarding", "monetization"];

export const STAGE_LABEL = {
  discover: "find product and docs",
  understand: "parse capability and price",
  signup: "create an account",
  access: "get a scoped key",
  pay: "complete a charge",
  use: "one metered call",
  manage: "change plan or cap",
};

export const STATES = ["BLOCKED", "HUMAN_REQUIRED", "AGENT_CAPABLE", "AGENT_VERIFIED", "NOT_TESTED", "NOT_APPLICABLE"];

export const RANK = { BLOCKED: 0, HUMAN_REQUIRED: 1, AGENT_CAPABLE: 2, AGENT_VERIFIED: 3 };

// tansohq.com intake form vocabulary ("where does it stop today?")
export const STOPS_AT = {
  discover: "web",
  understand: "web",
  signup: "signup",
  access: "access",
  pay: "pay",
  use: "pay",
  manage: "pay",
};

export const MATURITY_LABEL = ["Agent-Hostile", "API Exists", "Agent-Possible", "Agent-Friendly", "Agent-First"];

export const AUDIT_AREAS = ["onboarding", "authentication", "purchasing", "usage_monitoring", "self_management", "dev_readiness"];

export const AUDIT_AREA_STAGE = {
  onboarding: "signup",
  authentication: "access",
  purchasing: "pay",
  usage_monitoring: "use",
  self_management: "manage",
};

export const PROBE_IDS = ["pricing_json", "catalog_pricing", "agent_json", "llms_txt", "openapi", "robots_ai", "captcha", "signup_endpoint", "http_402"];

// Probes whose failure is a gap in an affordance, not evidence the stage cannot
// be done. They still produce findings; they do not decide a stage's state.
// /.well-known/agent.json is the case that forced this: a site with llms.txt and
// robots.txt open to AI bots is discoverable, and scoring it BLOCKED at discover
// made every stage after it unreachable, so stripe.com, vercel.com and
// linear.app all scored 0 of 7. Discovery is carried by whether an agent may
// crawl at all.
export const ADVISORY_PROBES = new Set(["agent_json"]);

export const PROBE_STAGE = {
  robots_ai: "discover",
  agent_json: "discover",
  llms_txt: "understand",
  openapi: "understand",
  captcha: "signup",
  signup_endpoint: "signup",
  pricing_json: "pay",
  catalog_pricing: "pay",
  http_402: "pay",
};

export function rank(state) {
  return state in RANK ? RANK[state] : null;
}

export function atLeast(state, floor) {
  const r = rank(state);
  return r !== null && r >= RANK[floor];
}
