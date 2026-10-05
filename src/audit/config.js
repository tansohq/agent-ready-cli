import { readFileSync, writeFileSync, existsSync } from "node:fs";

// agent-ready.yml at the repo root: the answers to the onboarding questions, committed so CI and later runs reuse them.
// Flat keys only, so it is read with a line parser rather than a YAML dependency.
export const CONFIG_FILE = "agent-ready.yml";
const KEYS = ["url", "task", "onboarding", "abuse_cost", "human_before", "verify_call", "verify_header", "verify_expect", "verify_assert", "verify_fields", "verify_body", "verify_exchange", "verify_exchange_body", "verify_exchange_token", "verify_hosts"];

export function readConfig(path) {
  if (!existsSync(path)) return null;
  const config = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([a-z_]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (match && KEYS.includes(match[1]) && match[2]) config[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return config;
}

// Rewriting the answers keeps any verify_* lines the user already filled in.
export function writeConfig(path, { url, task, answers }) {
  const kept = readConfig(path) || {};
  const verifyKeys = KEYS.filter((k) => k.startsWith("verify_"));
  const filledIn = verifyKeys.filter((k) => kept[k]);
  const verifyLines = filledIn.length
    ? ["# What `agent-ready verify` checks: one call made with the key the agent got.", ...filledIn.map((k) => `${k}: ${kept[k]}`)]
    : [
        "# What `agent-ready verify` checks: one call made with the key the agent got. Uncomment and fill in.",
        "# The checker also makes it with no key and with a wrong key; both must be refused (400, 401 or 403).",
        "# verify_call: GET https://api.example.com/v1/me",
        "# verify_header: Authorization: Bearer {key}",
        "# verify_expect: 200",
        "# verify_assert: id            # a field that must be present, or field=value",
      ];
  const lines = [
    "# agent-ready: how agents should onboard to this product. Edit and commit.",
    `url: ${url}`,
    `task: ${task}`,
    `onboarding: ${answers.onboarding.value}      # try_then_claim | limited_until_claimed | agent_is_customer | agent_identity | existing_account | pay_per_request`,
    `abuse_cost: ${answers.abuse_cost.value}      # low | high`,
    `human_before: ${answers.human_before.value}  # never | outbound | always`,
    "",
    ...verifyLines,
    "",
  ];
  writeFileSync(path, lines.join("\n"));
}
