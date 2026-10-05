// One fix prompt per finding, written for a coding agent (Claude Code, Cursor) working in the product's own repo.
// Each prompt says why (the audit's evidence), what to build for the chosen onboarding model, the security rules,
// and acceptance tests the coding agent writes and makes pass. agent-ready never writes the product's code.

const AI_AGENTS = "GPTBot, ClaudeBot, Claude-User, PerplexityBot, Google-Extended";

function header({ product, url }) {
  return [
    `You are working in the codebase for ${product} (${url}).`,
    "Read the repo first. Reuse its existing web framework, auth, API-key and billing code. Do not add a new auth system or framework.",
    "The endpoint paths below show the shape of each call. Fit them to the API's existing paths, naming and error format rather than adding new ones beside it.",
  ].join("\n");
}

// The owner's answer to "must a verified person exist before the agent acts?", as a rule for every prompt.
const HUMAN_RULE = {
  always: "A verified person must own the account before an agent can do anything with it. Keep that check on every endpoint below, including signup, purchases and plan changes.",
  outbound: "A verified person must own the account before an agent can affect anyone else: sending, publishing, charging or inviting. Keep that check on those endpoints.",
};

function whySection(finding, doc) {
  const urls = finding.basedOn.map((id) => doc.observations.find((o) => o.id === id)?.url).filter(Boolean);
  const lines = ["## Why", `agent-ready audit found: ${finding.reason}`];
  if (urls.length) lines.push(`Evidence: ${[...new Set(urls)].slice(0, 5).join(", ")}`);
  return lines.join("\n");
}

function modelSection(pattern, answers) {
  const rule = HUMAN_RULE[answers?.human_before?.value];
  return ["## Onboarding model", `${pattern.name}. A person steps in: ${pattern.humanBoundary}`, ...(rule ? [rule] : []), "Chosen in agent-ready.yml. If this is wrong, change it there and rerun the audit."].join("\n");
}

function list(title, items) {
  return [`## ${title}`, ...items.map((item) => `- ${item}`)].join("\n");
}

function numbered(title, items) {
  return [`## ${title}`, ...items.map((item, i) => `${i + 1}. ${item}`)].join("\n");
}

function closing(url) {
  return ["## When done", `Run \`npx @tansohq/agent-ready audit ${url}\` again. This finding should be gone. A static audit shows the path is documented; only a real agent run shows it works.`].join("\n");
}

const RATE_LIMIT = "Rate-limit by client IP and globally per hour. Take the client IP from the socket or from a proxy that overwrites X-Forwarded-For; never trust a client-appended X-Forwarded-For.";
const KEY_STORAGE = "Store only a hash of each API key. Show the key once, in the response that creates it. Never log it, put it in a URL, or include it in a redirect.";

function discoverBuild() {
  return {
    title: "Let agents in and give them an index",
    build: [
      `robots.txt: allow AI agents (${AI_AGENTS}) on public pages and docs. Keep any existing rules for private paths.`,
      "/llms.txt: a markdown index with the product name, a one-line description, and links to the docs, the API reference, pricing, authentication, and agent signup if there is one.",
      "Serve /llms.txt as text/plain, with no login and no JavaScript needed to read it.",
    ],
    security: ["Do not open private or account pages in robots.txt. This change is for public pages only."],
    tests: [
      "GET /robots.txt returns 200 and does not disallow the agents listed above on public paths.",
      "GET /llms.txt returns 200, text/plain, and every link in it resolves to a 200.",
    ],
  };
}

function understandBuild() {
  return {
    title: "Publish prices an agent can read exactly",
    build: [
      "/pricing.json: every public plan with id, name, price { amount, currency, period }, and what each plan includes or meters.",
      "Mark plans that need a person (for example contact sales) with an explicit field, rather than leaving the price out.",
      "Link /pricing.json from /llms.txt and from the pricing page.",
    ],
    security: ["Generate pricing.json from the same source as the pricing page, so the two cannot disagree."],
    tests: [
      "GET /pricing.json returns 200 and valid JSON.",
      "Every plan on the pricing page appears in pricing.json with the same amount and currency.",
    ],
  };
}

const CLAIM_TESTS = [
  "Signup returns 201 with every documented field, and the key authenticates GET /v1/agent/status.",
  "The 11th signup from one IP within an hour returns 429 with Retry-After.",
  "A claim-gated call returns 402 with error.code requires_claim and an action.",
  "A reused or expired claim code returns 400. A valid claim sets status to claimed, and the same key still works.",
  "An account past expires_at: its key returns 401 and its data is deleted.",
  "The API key never appears in logs.",
];

function claimEndpoints(limited) {
  return [
    `POST /v1/agent/signup, no auth. Body { agent_name (max 64), source (max 128), email? }. Returns 201 { account_id, api_key (shown once), status: "unclaimed", expires_at (now + 72h), limits, claim_gated, status_url, next_steps }. 400 { error: { code: "validation_failed", param } }; 429 { error: { code: "rate_limited" } } with Retry-After.`,
    "GET /v1/agent/status with the key: { status, expires_at, limits, usage, claim_gated }.",
    "POST /v1/agent/claim with the key: { user_code, verification_uri_complete, expires_in: 900 }. Mint the code only when called; never put a claim URL in the signup response.",
    "A person opens verification_uri_complete, signs in with the existing login, and picks an org. The account, its data and the agent's key move to that org. Status becomes claimed; expires_at becomes null.",
    limited
      ? `Before claim the key is limited to the restricted scope. Any call outside it returns 402 { error: { code: "requires_claim", action: "POST /v1/agent/claim", capability } }. Document exactly what the key can do before and after claim.`
      : `Claim-gated and over-limit calls return 402 { error: { code: "requires_claim", action: "POST /v1/agent/claim", capability } }.`,
  ];
}

function signupBuild(pattern, answers) {
  const highAbuse = answers.abuse_cost.value === "high";
  const outbound = answers.human_before.value === "outbound";
  const challenge = highAbuse
    ? ["GET /v1/agent/challenge returns a proof-of-work challenge; signup requires its solution. No CAPTCHA on this path."]
    : ["No CAPTCHA on this path. If abuse grows, add a proof-of-work challenge rather than a CAPTCHA."];
  const scope = outbound || pattern.id === "limited_until_claimed"
    ? ["Unclaimed accounts cannot send to third parties, publish, attach payment, or invite users."]
    : ["Unclaimed accounts cannot attach payment or invite users."];
  const discovery = "Document the flow in /auth.md and /agent-signup.md (endpoint, body, response, limits, expiry, claim steps, error codes), link both from /llms.txt, and add the signup path to openapi.json.";

  if (pattern.id === "try_then_claim" || pattern.id === "limited_until_claimed") {
    return {
      title: "Let an agent sign up and a person claim it later",
      build: [...claimEndpoints(pattern.id === "limited_until_claimed"), discovery],
      security: [KEY_STORAGE, "Claim codes are hashed, single-use, expire after 15 minutes, and are compared in constant time.", RATE_LIMIT, ...scope, "A scheduled job deletes accounts past expires_at with their data, revokes their keys, and logs each deletion.", ...challenge],
      tests: CLAIM_TESTS,
    };
  }
  if (pattern.id === "agent_is_customer") {
    return {
      title: "Let an agent sign up as the customer",
      build: [
        `POST /v1/agent/signup, no auth. Body { agent_name, email }. The email may be the agent's own inbox. Returns 201 { account_id, api_key (shown once), status, limits, next_steps }.`,
        "If email verification is needed, send a short code with a stated lifetime, and accept it at POST /v1/agent/verify.",
        "Repeating signup with the same email returns the existing account's status and a way to recover the key, not a dead end.",
        "A funding endpoint the agent can call, or a 402 with a link a person approves, before paid usage.",
        discovery,
      ],
      security: [KEY_STORAGE, RATE_LIMIT, "Do not reveal whether an email is registered in a way that allows enumeration.", ...challenge],
      tests: [
        "Signup returns 201, and the key authenticates a read call.",
        "Signup again with the same email returns a recoverable response, not 409 with no next step.",
        "The 11th signup from one IP within an hour returns 429 with Retry-After.",
        "The API key never appears in logs.",
      ],
    };
  }
  if (pattern.id === "existing_account" || pattern.id === "agent_identity") {
    return {
      title: "Let an agent get access through a person, without a browser session",
      build: [
        "An OAuth 2.0 device authorization flow (RFC 8628) on the existing login: POST /oauth/device_authorization returns { device_code, user_code, verification_uri_complete, interval, expires_in }; the agent polls POST /oauth/token.",
        "The person approves on the verification page and chooses the scopes. The agent receives a scoped token.",
        "When the agent cannot continue without a person, return a structured error: { error: { code: \"human_required\", action, url } }.",
        "Document the flow in /auth.md, link it from /llms.txt, and declare the scheme in openapi.json securitySchemes.",
      ],
      security: ["Device codes expire within 15 minutes and are single-use.", "The approval page shows which agent and which scopes are being granted.", "Tokens are scoped; the default grant is read-only.", RATE_LIMIT],
      tests: [
        "The device flow returns a user_code, and polling before approval returns authorization_pending.",
        "After approval, polling returns a token that works only within the granted scopes.",
        "An expired device code returns expired_token.",
      ],
    };
  }
  return {
    title: "Let an agent pay per request instead of signing up",
    build: [
      "A priced endpoint called without payment returns 402 with machine-readable payment requirements (amount, currency, accepted methods, where to pay).",
      "The agent retries the same request with payment attached and gets the result. Retries are idempotent: one payment, one result.",
      "Document the price per call in /pricing.json and the flow in /auth.md.",
    ],
    security: ["Reject replayed payments.", "Cap the amount any single request can charge."],
    tests: ["A call without payment returns 402 with payment requirements.", "A paid retry returns 200; replaying the same payment is rejected."],
  };
}

function accessBuild() {
  return {
    title: "Document how an agent authenticates",
    build: [
      "/auth.md: how to get a key, how to send it (header name and format), scopes, and what a 401 looks like.",
      "Declare the scheme in openapi.json components.securitySchemes and apply it to operations.",
      "Return 401 as JSON with a WWW-Authenticate header. If you use OAuth, serve /.well-known/oauth-protected-resource and name it in WWW-Authenticate (RFC 9728).",
    ],
    security: [KEY_STORAGE, "Issue scoped keys; the default is the least access that does the job."],
    tests: ["A request with no key returns 401 JSON with WWW-Authenticate.", "openapi.json declares the scheme and every operation that needs it references it."],
  };
}

function useBuild() {
  return {
    title: "Publish an API spec an agent can call from",
    build: [
      "openapi.json at a stable public URL, covering the actions customers need, with summaries, request and response schemas, and securitySchemes.",
      "Structured errors: { error: { code, message, param? } } with stable codes an agent can act on.",
      "Link the spec from /llms.txt and the docs.",
    ],
    security: ["Do not publish internal or admin operations in the public spec."],
    tests: ["GET /openapi.json returns 200 and validates as OpenAPI 3.", "Every documented operation returns errors in the structured shape."],
  };
}

function payBuild(pattern) {
  if (pattern.id === "pay_per_request") return signupBuild(pattern, { abuse_cost: { value: "low" }, human_before: { value: "never" } });
  return {
    title: "Let an agent buy a plan without a browser checkout",
    build: [
      "A person saves a payment method once and sets a spend cap for agents (a mandate).",
      "The agent buys or upgrades through the API: POST /v1/subscriptions or /v1/plan-change, with an Idempotency-Key.",
      "When no mandate exists or the cap would be exceeded, return 402 { error: { code: \"payment_required\", approval_url } } for a person to approve.",
      "List purchasable plans in /pricing.json with the endpoint that buys each.",
    ],
    security: ["Charge before the plan changes, not after.", "Enforce the spend cap on the server for every charge.", "Idempotency-Key replays return the original result and never charge twice."],
    tests: [
      "With a mandate, an upgrade call charges once and moves the plan.",
      "Over the cap, the call returns 402 with approval_url and the plan does not move.",
      "Replaying the same Idempotency-Key does not charge again.",
    ],
  };
}

// A static audit can miss a path that exists: Moltbook lets an agent sign up, but its public pages did not show it.
// Before building, the coding agent checks for an existing path and documents it instead of building a second one.
const CHECK_FIRST = {
  signup: "## Check first\nThe audit did not find an agent signup path in the public pages. That does not mean there is none. Search the repo for an existing signup or registration endpoint an agent could call. If one exists, document it in /auth.md and /llms.txt instead of building the endpoints below.",
  access: "## Check first\nSearch the repo for how API keys are issued today. If an agent can already get one, document that path in /auth.md instead of building a new one.",
};

function buildFor(finding, pattern, answers) {
  if (finding.step === "discover") return discoverBuild();
  if (finding.step === "understand") return understandBuild();
  if (finding.step === "signup") return signupBuild(pattern, answers);
  if (finding.step === "access") return accessBuild();
  if (finding.step === "use") return useBuild();
  if (finding.step === "pay") return payBuild(pattern);
  return null;
}

export function promptTitle(finding, pattern, answers) {
  return buildFor(finding, pattern, answers)?.title || finding.name;
}

export function renderPrompt({ finding, pattern, answers, doc, product, url }) {
  const spec = buildFor(finding, pattern, answers);
  if (!spec) return null;
  return [
    `# ${spec.title}`,
    header({ product, url }),
    whySection(finding, doc),
    ...(CHECK_FIRST[finding.step] ? [CHECK_FIRST[finding.step]] : []),
    modelSection(pattern, answers),
    numbered("Build", spec.build),
    list("Security", spec.security),
    list("Acceptance tests (write them and make them pass)", spec.tests),
    closing(url),
  ].join("\n\n") + "\n";
}
