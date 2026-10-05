# Changelog

## 0.2.0 (2026-10-05)

- `audit` recognizes a token a person creates that the product's CLI then takes from a flag or an environment variable ("Set the VERCEL_TOKEN environment variable", "use --with-token to pass in a personal access token"), and a CLI that signs in only through a browser. GitHub and Vercel had scored "needs a person" for Sign up and Access because their docs never say "API key in the dashboard"; both now read as a handoff, 5 of 7. Across the 25 products in the October sweep, no other verdict changed.
- `verify` can test products whose agents start with a CLI. `verify_cli: npm` (or `pypi`) lets the agent install from that registry. Installs, caches and saved CLI logins go under `.tools/` in the run folder, the only place the agent's sandbox can write, and saved logins are scrubbed. Node's `fetch` now goes through the sandbox's proxy (`NODE_USE_ENV_PROXY=1`): without it, any CLI built on `fetch` failed with `ENOTFOUND`.
- Real runs through each product's own CLI, all passing the three-call check: Mem0 with `mem0 init --agent` (18 turns, $0.16), Neon with `neon init -y --claimable` (18 turns, $0.17) and Cloudflare with `wrangler deploy --temporary` (24 turns, $0.22). Each CLI saved its credential under `.tools/home`, and the agent read it from there. The first Neon and Cloudflare runs used the CLI correctly but saved no key, because their tasks did not say which value was the key; the agent's instructions now say to save the credential even when a CLI keeps it in a file, and the docs say to name the key in `task` when a product returns several secrets.
- A claim link in the form `?claimToken=…` (Cloudflare's temporary accounts) was not scrubbed from the agent's notes. Any link parameter named like a token is now treated as a secret.
- Correction to 0.1.7: the Mem0 run did not pass through Mem0's CLI. The CLI installed, `mem0 init --agent` failed with "fetch failed" (the proxy problem above), and the agent then signed up over HTTP. The pass itself stands.

## 0.1.9 (2026-10-05)

- Two skills replace the old one, which taught agents the hidden `scan` and `crash` commands instead of `audit` and `verify`. `agent-ready` runs the audit; `agent-ready-verify` runs a real agent and, in Claude Code, starts only when you type `/agent-ready-verify`. In fresh Claude Code sessions, "audit neon.com with agent-ready" ran the audit (5 turns, $0.03), "run agent-ready verify on neon.com" showed the plan and pointed to `/agent-ready-verify` without starting a run, and `/agent-ready-verify neon.com` stopped at the plan to ask for a yes.
- The package is a Claude Code plugin (`claude plugin marketplace add tansohq/agent-ready-cli`), and `npx skills add tansohq/agent-ready-cli` installs the skills for Codex, Cursor and other agents that read `.agents/skills`.
- `verify --max-budget-usd` caps the agent's model use, default $5. Claude Code checks it after each turn, so a run can end slightly above it, and a run stopped there is inconclusive. The confirmation said a run costs "about $1 to $4", taken from September runs; October runs cost $0.06 to $0.47, and it now says so.
- README: quickstarts for the terminal, a coding agent and CI, and new sections on cost, accounts and data, and on limits, with the numbers from the code.
- AGENTS.md ships in the package and the public repository, for agents that use or change the tool.

## 0.1.8 (2026-10-05)

- A Neon run printed and saved the project's database password: the check `verify_assert: database_url` showed the field's value, and the agent's trace kept the connection string. An assertion with no `=value` now reports only that the field is present, and the scrubber removes the password from any connection string (`postgres://user:password@…`) and Neon's `npg_` tokens, whatever the field is called.
- `verify --check` shows what a run would do without starting the agent or making a request: Claude Code installed and signed in, the hosts the agent may reach, the inbox, what the agent saves and the calls the checker makes. Exits `0` when ready, `2` when not; `--json` prints `agent-ready/verify-plan@1`. A real run now also stops at the start when Claude Code is signed out, instead of failing inside the agent.
- The `agent-ready.yml` that `audit` writes lists every optional verify setting with a comment, and says the agent saves its key as `AGENT_READY_KEY` in `work/CREDENTIAL.env`, so the task need not.
- README: removed a line saying exchanges were unsupported (0.1.7 added them); documented `--check`, how the key is saved, and `execute`.
- The identity guard's message names the blocked address as the one that is not the test identity; it read as if the blocked address were the identity.

## 0.1.7 (2026-10-05)

- `verify` checks products that need more than one plain call: `verify_fields` (values the agent saves next to its key, used as `{NAME}` in the call), `POST` calls with `verify_body`, and an exchange step (`verify_exchange`, `verify_exchange_body`, `verify_exchange_token`) that turns the key into the token the check uses. `verify_hosts` lets the agent reach a CLI's package registry or a second domain. Real runs: Neon passed through its assertion-for-token exchange (12 turns, $0.13), Mem0 passed with a `Token` header and its CLI from npm (41 turns, $0.34).
- A 400 for a missing key counts as refused, alongside 401 and 403: Cloudflare answers that way, and a working Cloudflare key was reported as a failure. A second Cloudflare run used its 40 turns reading docs and got no key, so Cloudflare is not yet confirmed as a pass.
- Server errors are counted only from real 5xx responses (a status line or field, the reason phrase, or a short label and code on their own line). A bare number in prose had made that Cloudflare run read as an outage. Against every recorded run, only monday.com's real 503s match.
- When the trace shows no key and the agent's own notes report a 5xx, verify says the result is inconclusive and that it is the agent's report: Inkbox's 500s reached the agent through `curl -s`, which drops the status line.

## 0.1.6 (2026-10-05)

- The testing agent can no longer use a real person's email address. Claude Code tells the model the signed-in account's email, and two runs (Inkbox, Edge Network) gave it to the product as the account's human contact, one through a script the agent wrote and then ran. A PreToolUse hook now refuses any command, request or written file (other than the agent's own notes) that carries an address other than the test identity's; placeholder domains such as example.com are allowed. The persona instructions say the same. Checked with a real `claude -p` run.
- Mail is scrubbed of short codes after "code", "OTP", "passcode" or "PIN" and of long links, which in these emails are one-time: a Cosmic run had kept its claim code and a click-tracking claim link.

## 0.1.5 (2026-10-05)

- `verify` with `AGENTMAIL_API_KEY` set gives each run its own inbox and deletes it afterwards; documented in the README. Real runs: Cosmic (needs an email) and Telnyx (accepts the agent's own email) both passed, $0.15 each.
- Emails in the run's `inbox/` are scrubbed after the run, and one-time tokens in links (`?token=`, `?code=`, `?claim=`, `?portal_redirect_token=` and similar) are treated as secrets everywhere. The Telnyx run had left a one-time sign-in link in its saved mail: the scrub skipped subfolders and only knew JSON field names.

## 0.1.4 (2026-10-05)

- The npm package is built into `dist/cli` with its own `package.json` that depends only on `commander` and `aeo-ready`: about 15 MB installed instead of 65 MB, with no server dependencies (`pg`, Clerk, Vercel) and no Playwright. The hidden browser and video commands say how to install Playwright when they need it.
- Source is public at https://github.com/tansohq/agent-ready-cli, and the package links there.
- Tests that start the server or read run traces moved into their own files, so the CLI's tests ship with the public source and pass there.

## 0.1.3 (2026-10-05)

- `audit` writes `audit-report.json` (`agent-ready/audit-report@1`) instead of `audit.json` (`agent-ready/audit@1`). The Claude Code skill writes `audit.json`, in another format, into the same run folder, and `report` and `validate` read that file. Rename any script that reads the old name.
- `verify` checks that Claude Code is installed before starting and says how to install it, instead of reporting an inconclusive run.
- The Claude Code skill and `AGENTS.md` name the scoped package (`npx @tansohq/agent-ready`).
- Agents can drive the CLI without a terminal: each audit question has a flag (`--onboarding`, `--abuse-cost`, `--human-before`); with `--json`, every error from audit and verify, including usage errors, is a JSON document on stdout (`agent-ready/error@1`, with `code`, `message` and `hint`); and the audit JSON lists the files it wrote (`files.prompts`, `files.brief`, `files.config`). The README has a section for agents.
- Every fix prompt carries the owner's answer to "must a verified person exist before the agent acts?", not only the signup prompt, and says to fit the example endpoints to the product's existing API. Found by an agent doing a developer's task with the CLI.
- The verdict says how many working steps rely on a person handing the agent access, and wraps to 80 columns.
- Tested on Node 20.20 (the supported floor is 20.9): all tests pass and `audit` runs.

## 0.1.2 (2026-10-05)

Found by testing the published package as a new user and auditing 13 more companies.

- `audit --yes` writes `agent-ready.yml` with the defaults when there is none, so `verify` has a file to read and the prompts' "chosen in agent-ready.yml" is true. It never overwrites an existing file.
- One score everywhere: the terminal, `audit.json` and `brief.md` all say "Your public pages show N of 7 steps working". The brief had used the older count that stops at the first gap, so Buttondown read 3 of 7 in the terminal and 2 of 7 in the brief.
- Onboarding detection no longer reads "Agent Mode" (Postman, Copilot) or WhatsApp "Self Sign-up" (Twilio) as an agent signing itself up; Linear, GitHub and Twilio had been told agents can sign up. It now reads "manage your API keys at …" (Buttondown) as a person handing the agent a key.
- Use counts API operations, not OpenAPI tag groups: Resend went from "15 documented actions" to its real operation count.
- The product name drops the page title's tagline ("Resend", not "Resend · Email for developers").
- "Next" gives the prompt's full path from where you ran the command.
- The README covers only the npm commands, with a complete `agent-ready.yml`; the dashboard and hidden commands moved to `docs/repository-guide.md`.

## 0.1.1 (2026-10-05)

- README leads with `npx @tansohq/agent-ready audit` and `verify`; the hosted dashboard has its own section.
- Package links point to tansohq.com instead of the private repository.
- `verify` output wraps long check details to 80 columns.
- `serve` names the repository by path instead of a GitHub URL the public cannot open.

## 0.1.0 (2026-10-05)

First release on npm as `@tansohq/agent-ready`.

- A product on your own machine works end to end: a bare `localhost` or IP address means `http://`, audit saves the full address to `agent-ready.yml`, and the agent's sandbox opens localhost (`allowLocalBinding`, macOS) only when the target itself is local. A run where the agent cannot connect at all is inconclusive, not a failure.
- The onboarding model you choose drives the fixes: a product whose docs only describe a person handing over a key now gets a signup fix when you choose an agent-first model.
- Full loop checked on a local sample product: audit (3 of 7 working, 3 fixes), a coding agent applied two prompts (11 turns, $0.68, its 12 tests pass), re-audit (5 of 7, 1 fix left: Pay, not applied), verify PASS in 8 turns for $0.06 with an account the agent created itself.
- Known limit: a product whose key must be exchanged for a second token before it works (Neon's claimable projects) cannot be checked with one declared call yet.

- `verify [url]`: a real agent (local Claude Code) tries the task in `agent-ready.yml` on your own product. The checker is the call you declare (`verify_call`, `verify_header`, `verify_expect`, `verify_assert`), made with the agent's key, with no key and with a wrong key; it passes only when the key works and both others are refused. A call that answers without a key is reported as inconclusive. Asks before creating an account (`--yes` skips). Exit 0 pass or correct handoff, 1 fail with a fix prompt, 2 usage, 3 inconclusive, 130 cancelled. First real run: app.tansohq.com passed in 11 turns for $0.37.
- The harness takes a task built at run time and can sign up with no inbox. Rewriting `agent-ready.yml` from the audit questions keeps any `verify_*` lines.
- Secrets a product returns to the agent (fields named key, token, secret, claim code and similar) are learned from each full line of agent output before anything is written, so they are scrubbed from the trace even when the agent never writes `CREDENTIAL.env`. Real runs had left a claim code, and once a full key, in `trace.jsonl`: the event log keeps only the first 400 characters of each result, and `curl -i` headers filled them.
- The agent no longer inherits the operator's Claude Code setup: `--strict-mcp-config --setting-sources project,local`. Before this, a run loaded the operator's MCP servers (37, including Gmail, Slack and Drive), user hooks, plugins and CLAUDE.md. Runs before this change, including the examples in `examples/signup/`, had that setup loaded; their checker results came from independent API calls, but agent behavior may have been affected.
- An agent with no output for 5 minutes is stopped and reported as stalled. A run that does not finish (stalled, timed out, stopped) is inconclusive, never a failure of the product.

- `audit <url>`: one command for your own product. Reads public pages (GET only), shows the seven steps with how each was found (`from your files`, `from page text`, `needs agent run`), asks three onboarding questions with defaults from your docs, saves the answers to `agent-ready.yml`, and writes `brief.md` plus one fix prompt per gap in `prompts/`. Prompts carry the evidence, the chosen onboarding model, security rules and acceptance tests, and tell the coding agent to check for an existing path before building a new one. `--json` prints `agent-ready/audit@1`; `--fail-on high|medium` exits 1; no answers without a terminal exits 2; a cancel at a question exits 130 and saves nothing.
- The funnel lists Use before Pay: in every passing live run the agent made real calls on a free key before any payment.
- Wording no longer claims more than public pages show: a missing signup reads "was not found in the pages read", not "a person has to create the account".
- Onboarding detection counts a signup call (`POST …/agents/register`, `…/signup`) documented on a page written for agents as agent signup. Moltbook is now recognised as limited until claimed; its recorded pages join the fixture set.
- `--help` shows `audit` and `execute`. Other commands still run and are hidden from help.
- `audit` stops instead of scoring a site that did not answer: no DNS record, a refused connection, a timeout or a 5xx exits 3 and writes nothing. A malformed address or a missing one exits 2 with an example. `--help` lists example commands. An answer that is not an option is asked again rather than read as the default.
- HTTP errors keep their cause code (`fetch failed (ENOTFOUND)`), so a failed fetch says why.

- Every check answers in seven steps. `POST /v1/interface` and saved checks carry `funnel` (`agent-ready/funnel@1`): Discover, Understand, Sign up, Access, Pay, Use, Manage, each `agent_can`, `handoff`, `needs_person`, `blocked` or `not_checked`, with the reason, what to build, and its evidence. A documented handoff to a person passes. `GET /v1/runs` includes each check's funnel summary.
- Dashboard: one URL box for a new workspace, a card per product with its latest steps, and reports that open on the steps with the evidence one click down. Two nouns, Check and Live test. Test it live on a step opens a live test with that step's task already written.
- Public live tests may follow the product's own subdomains (docs.example.com for example.com), GET only, never to an IP, another port or another site. A redirect that leaves the product now says where it went.
- Live tests remember the step they prove (`step` on a flow). The latest passed live test for a step shows it as `agent_did` on every check of that product; a blocked one sets `blocked` with the stop reason. Inconclusive tests change nothing.
- Docs, llms.txt and the README describe the check, the seven steps and live tests.

- `interface <url>` and `serve`: URL → structured agent interface (`agent-ready/interface@1`) with observations, evidence-backed facts, rule-based verdicts, unknowns; HTTP API + dashboard; `POST /v1/evaluate` runs a rule-based journey (`agent-ready/journey@1`): discover, understand, choose_interface, authenticate from evidence; execute and recover reported not_run.
- `execute --task stripe-subscription`: real task harness. Secret boundary (env-only, test-mode only, redacted everywhere), executor interface with a disposable `claude -p` implementation (scratch dir, tool allowlist, sandboxed network allowlist), structured trace, deterministic evaluator, reconciliation of extractor vs agent per stage. First real run in `examples/stripe-subscription/run-01/`.

- Seven-stage funnel contract (`discover → understand → signup → access → pay → use → manage`) with four ordered states plus not-tested / not-applicable.
- `scan`: aeo-ready benchmarks as a sandboxed child plus nine GET-only probes (robots AI rules, agent.json, llms.txt, OpenAPI, pricing.json, catalog pricing, CAPTCHA, signup endpoint, 402 handoff).
- `crash --smoke`: Playwright walk of pricing and signup pages with screenshots; never submits.
- Skill for Claude Code / Codex / Cursor / Gemini with the audit step (vendored agent-serve rubrics) and the full crash persona.
- `report`: merge, delta against history, self-contained HTML, markdown twin, JSON.
- `demo`: customer-task walkthrough in the tansohq.com demo layout (Before / After, step states, evidence), with `--video` recording to webm/mp4; `crash --smoke --video` records the real browser walk.
- `replay`: the agent's run played back request by request with its own commentary, recordable with `--video`.
- `reel`: one mp4 from walkthrough, UI clips, smoke walk and replay.
- `hero`: the 55-second launch cut, 16:9 and 1:1, captions burned in and as WebVTT; `export`: AV1/VP9 webm and posters; `--label` and page-zoom capture at the delivery frame for demo and replay.
- Skill: the crash step runs and records the product's crash dummy for the UI half of the funnel, watches the footage, and produces demo, replay and reel.
