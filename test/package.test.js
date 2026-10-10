import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

// Claude Code installs the plugin by its own version, so it must move with the package.
test("the Claude Code plugin's version matches the package's", () => {
  assert.equal(read(".claude-plugin/plugin.json").version, read("package.json").version);
});

test("the test skill runs only when the user asks for it", () => {
  const skill = readFileSync(new URL("../skills/agent-ready-test/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^disable-model-invocation: true$/m);
});
