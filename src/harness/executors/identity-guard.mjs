#!/usr/bin/env node
// PreToolUse hook for the testing agent. Refuses a command or fetch that carries an email address other than the
// test identity's. Claude Code tells the model the signed-in account's email, and an Inkbox run used it as the
// human contact for a test account, so an instruction alone is not enough. Placeholder domains are allowed.
//   node identity-guard.mjs [allowed-email ...]   (hook input arrives as JSON on stdin)
import { readFileSync } from "node:fs";

const allowed = new Set(process.argv.slice(2).filter(Boolean).map((e) => e.toLowerCase()));
const PLACEHOLDER = /@(?:example\.(?:com|org|net)|[a-z0-9-]+\.example|[a-z0-9-]+\.invalid|[a-z0-9-]+\.test)$/i;
const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const ti = input.tool_input || {};
// Files count too: an Edge Network run wrote the address into signup.py and then ran `python3 signup.py`, a command
// with no address in it. The agent's own notes are exempt, since they quote a product's support address.
const NOTES = /(?:^|\/)(?:PLAN|RESULT|NEEDS_HUMAN|NEEDS_CREDENTIAL)\.md$/;
const written = NOTES.test(ti.file_path || "") ? [] : [ti.content, ti.new_string, ...(ti.edits || []).map((e) => e.new_string)];
const text = [ti.command, ti.url, ti.prompt, ...written].filter((v) => typeof v === "string").join("\n");
const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi) || [];
const refused = [...new Set(found.filter((e) => !allowed.has(e.toLowerCase()) && !PLACEHOLDER.test(e)))];
if (refused.length) {
  const own = allowed.size ? `Use only ${[...allowed].join(", ")}.` : "This run has no email address of its own.";
  process.stderr.write(`Blocked: this uses ${refused.join(", ")}, which is not this run's test identity. Never use a real person's address, including any you know from your own context. ${own} If the product needs a person's email, write NEEDS_HUMAN.md naming that step and stop.\n`);
  process.exit(2);
}
