# agent-ready

Can an AI agent sign up for your product and use it without a person? Two commands answer it for your own product.

```bash
npx @tansohq/agent-ready audit yourproduct.com   # free, reads public pages, writes fix prompts
npx @tansohq/agent-ready verify                  # a real agent tries it; a separate check decides
```

- **`audit`** reads your public pages the way an agent does, shows seven steps (Discover, Understand, Sign up, Access, Use, Pay, Manage), asks three questions about how agents should onboard, and writes one fix prompt per gap for your coding agent. It submits nothing.
- **`verify`** has a real agent (your local Claude Code) try the task on your product, then checks the key it got with a call you declare: with the key, with no key, and with a wrong key.

The loop: audit, paste a prompt into Claude Code or Cursor, audit again, then verify.

Install once with `npm i -g @tansohq/agent-ready` to run `agent-ready audit …` and `agent-ready verify`. Needs Node 20.9 or later; `verify` also needs [Claude Code](https://claude.com/claude-code) signed in.

## For agents

If you are an agent running this for a developer, nothing needs a terminal:

```bash
npx @tansohq/agent-ready audit example.com --json --yes
npx @tansohq/agent-ready audit example.com --json --onboarding existing_account --abuse-cost high --human-before always
npx @tansohq/agent-ready verify --json --yes        # creates a real account on the product; ask the developer first
```

- `--json` prints one JSON document to stdout: `agent-ready/audit-report@1` for audit (with `files.prompts`, `files.brief` and `files.config`, relative to where it ran), `agent-ready/verify@1` for verify, and `agent-ready/error@1` for any error, as `{ error: { code, message, hint } }`.
- The three questions have flags: `--onboarding`, `--abuse-cost`, `--human-before`. Any of them, or `--yes`, means no prompt; unanswered ones take their defaults. `--human-before never` lets an agent act alone, `outbound` requires a verified person before an agent sends, publishes, charges or invites, and `always` requires a verified person to own the account before any use. The fix prompts carry that rule.
- Exit codes: `0` done, `1` fixes at or above `--fail-on` (audit) or the check failed (verify), `2` usage or setup, `3` the site did not answer or the run was inconclusive, `130` cancelled.
- Each fix prompt is written for a coding agent: read `files.prompts[0]`, make the change in the developer's repository, run its acceptance tests, then run audit again.

## Audit your product

```bash
npx @tansohq/agent-ready audit yourproduct.com
```

`audit` reads your public pages (GET only, nothing is submitted), shows the seven steps, asks three questions about how agents should onboard, and writes one fix prompt per gap for your coding agent (Claude Code, Cursor). It never writes your product's code.

```
  agent-ready audit · neon.com
  Read 23 public pages. GET only, nothing submitted.

  Your public pages show 5 of 7 steps working.
  1 needs a fix. 1 needs a real agent run to check.

  ✓ Discover      The site is open to agents and has an index   from your files
                  written for them (/llms.txt with 277 links).
  ✓ Understand    Prices are written in the page text, so an    from page text
                  agent can read them, though it has to
                  interpret prose to compare plans.
  ✓ Sign up       The docs describe an agent signing up on its  from page text
                  own (Try first, claim later). It needs:
                  inbox.
  ✓ Access        The agent signup path hands back a key the    from your files
                  agent can use.
  ✓ Use           159 API operations in a machine-readable API  from your files
                  spec.
  ✗ Pay           Paid plans are published, but nothing         from page text
                  documents a way for an agent to buy one, so
                  a person has to check out.
  · Manage        Changing a plan or a limit can only be        needs agent run
                  proven by a live agent.

  Onboarding  Try first, claim later (documented · defaults saved to agent-ready.yml)

  1 fix  a prompt for your coding agent
    01  Pay       Let an agent buy a plan without a browser checkout

  Next  paste this prompt into your coding agent:
        .agent-ready/neon.com/2026-10-05T04-16-47-6z7wqj/prompts/01-pay.md
        then run npx @tansohq/agent-ready audit neon.com again

  Folder  .agent-ready/neon.com/2026-10-05T04-16-47-6z7wqj/
          prompts/ for the fixes · brief.md for security, legal, billing
```

The right-hand column says how each step was found: `from your files` (a structured file or an HTTP status), `from page text` (matched in prose, so it can be wrong), or `needs agent run` (public pages cannot show it). An audit never reports a step as verified; only a real agent run can.

The three questions pick the onboarding model the prompts build toward: who holds the account when an agent first uses it, what one abusive free account costs, and whether a verified person must exist before the agent acts. Defaults come from what your docs describe. Answers are saved to `agent-ready.yml`; commit it and later runs reuse it.

Each run writes `.agent-ready/<host>/<runId>/` with `audit-report.json`, `interface.json`, `brief.md` (a one-page brief for security, legal and billing) and `prompts/` (one file per fix, plus `ALL.md`). Every prompt says why, what to build for the chosen model, the security rules, and acceptance tests the coding agent writes and makes pass.

| Flag | Does |
| --- | --- |
| `--yes` | Accept the defaults without asking. Writes `agent-ready.yml` with them if there is none; never overwrites one. |
| `--ask` | Ask again even if `agent-ready.yml` has answers. |
| `--json` | Print `audit-report.json` (`agent-ready/audit-report@1`) to stdout. |
| `--fail-on high\|medium` | Exit 1 when a fix at that severity or above is found. |
| `--no-color` | Plain output. `NO_COLOR` is respected too. |

Exit codes: `0` done, `1` fixes at or above `--fail-on`, `2` usage error, a malformed address, or no answers without a terminal (run it in a terminal once, or pass `--yes`), `3` the site did not answer (no DNS record, refused, timeout or a 5xx; nothing is written), `130` cancelled at a question.

In CI: `npx @tansohq/agent-ready audit $URL --fail-on high --json`, with `agent-ready.yml` committed.

## Verify with a real agent

```bash
npx @tansohq/agent-ready verify
```

`verify` has a real agent (your local Claude Code) try the task in `agent-ready.yml` on your product, then checks the key it got with a call you declare. `audit` writes the file; add the `verify_*` lines to it. A complete file:

```yaml
url: yourproduct.com
task: Sign up as an agent, get an API key, and make one authenticated read call
onboarding: try_then_claim      # try_then_claim | limited_until_claimed | agent_is_customer | agent_identity | existing_account | pay_per_request
abuse_cost: low                 # low | high
human_before: never             # never | outbound | always

verify_call: GET https://api.yourproduct.com/v1/me
verify_header: Authorization: Bearer {key}   # default
verify_expect: 200                           # default
verify_assert: id                            # optional: a field that must be present, or field=value
```

The checker makes that call three times: with the agent's key (must return `verify_expect` and pass the assertion), with no key, and with a wrong key (both must be refused with 401 or 403). A call that answers without a key proves nothing, so verify says so instead of passing.

```
  agent-ready verify · app.tansohq.com
  Task: Sign up as an agent, get an API key, and make one authenticated read call

  ✓ Got a key          the agent got its own key; redacted from every file
  ✓ Key works          GET https://app.tansohq.com/v1/account → 200
  ✓ No key refused     without a key → 401
  ✓ Wrong key refused  with a wrong key → 401

  PASS  A real agent got its own key and the checker confirmed it works.
  11 turns · $0.37 · evidence in .agent-ready/app.tansohq.com/2026-10-05T02-35-22-et9ch3/
```

It works on a product running on your machine too (`url: localhost:3000` means `http://localhost:3000`; on macOS the agent's sandbox opens localhost only for a local target). One declared call is the whole check, so a product whose key must first be exchanged for a second token (Neon's claimable projects) is not supported yet.

It creates a real account on the product, named with the run id, and asks before starting (`--yes` skips the question). The agent can reach only the product's own hosts and the verify call's host. For products that email a code or a link, set `AGENTMAIL_API_KEY` (an [AgentMail](https://agentmail.to) key): each run gets a fresh inbox, the agent reads the mail from it, and the inbox is deleted afterwards. Cosmic and Telnyx both passed this way. With no inbox (`AGENTMAIL_API_KEY` unset and no `--inbox`), the agent stops and says so where a product requires email. The key, claim codes, and one-time codes and links in the agent's mail are scrubbed from every file after the check. The agent may use only its test identity's email address: Claude Code tells the model the signed-in account's email, so a hook refuses any command, request or written file that carries another real address, and with no inbox the agent has no address at all.

Exit codes: `0` passed (or a correct handoff when your onboarding model says a person sets access up first), `1` failed (a fix prompt is written to the run's `prompts/`), `2` usage error or missing `verify_call`, `3` inconclusive (the product returned server errors, the run did not finish, or the verify call answers without a key), `130` cancelled.

## More

Source: https://github.com/tansohq/agent-ready-cli. Issues and questions go there. The hosted dashboard at app.tansohq.com is a separate service and not part of this package.
