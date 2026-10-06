# AGENTS.md

## Using agent-ready on a product

- To audit a product, follow `skills/agent-ready/SKILL.md`: `npx @tansohq/agent-ready check <url> --json --yes`. It reads public pages only and costs nothing.
- To run a real agent against a product, follow `skills/agent-ready-verify/SKILL.md`, and only when the developer asks. `test --check` is free; a real `test` creates an account on the product and spends model money (capped by `--max-budget-usd`, default 5).

## Working on this code

- Node 20.9 or later, ES modules, no build step for the CLI. `npm test` runs every test with `node --test`.
- `bin/cli.js` defines the commands. `src/audit/` is `check`, `src/verify/` is `test`, `src/harness/` runs the agent (`claude -p`) and scrubs secrets, `src/interface/` reads a product's public pages.
- The `--json` documents (`agent-ready/audit-report@1`, `agent-ready/verify@1`, `agent-ready/verify-plan@1`, `agent-ready/error@1`), exit codes and `agent-ready.yml` keys are contracts for agents and CI. Change one only with a CHANGELOG entry.
- The two skills and the README quote flags, defaults and limits from the code. When you change one in the code, change it there too.
- Keep `.claude-plugin/plugin.json`'s `version` equal to `package.json`'s; a test checks it.
