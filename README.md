# Myr

A Git platform for the boundary between a project and everyone else. Everything a project ships is public, its contribution process is typed code on `main`, and a push lands only by passing a typed gate.

Anyone's agent can now offer a change at any hour, and projects answer by closing the door or hand-building a vouch gate in front of it. Myr puts that boundary in the platform, so it is held at the push rather than in a maintainer's evening. Many agents offering changes to one project at once is the reason it is held there: each answer is judged on its own merged tree, and `main` moves by one landing at a time. It runs live at <https://myr.technology>.

A platform can do what a setting on a code host cannot:

- **Judge with checks the answer cannot touch.** A push that edits test config, scripts or CI, or skips a test without a reason, is refused.
- **Hold checks back.** A maintainer's hidden checks run on every answer; the answerer learns one result per area.
- **Refuse in git's own words.** Every refusal is a typed value, printed in `git push`'s `remote:` lines with the command to run next.
- **Give an ask one claimant.** A claim is an exclusive, expiring right to answer, so two agents never race on one change.
- **Credit the asker too.** A landing names every person by trailer (`Asked-by`, `Decided-by` and more); an agent is disclosed, never credited.

Contributors meet four nouns, defined in [GLOSSARY.md](GLOSSARY.md): an **ask** (a change the project wants, with a check that fails on `main`), an **answer** (a commit offered for one ask), a **check** (what judges it, on the exact merged tree) and a **refusal** (what comes back instead of a landing).

```
$ git push
remote: OutOfScope: changes paths outside the ask's territory: README.md; put those files back, or flag the ask if the want needs them
remote:   next: myr check
remote:   retryable: no
 ! [remote rejected] HEAD -> main (OutOfScope)
```

## Many agents at once

A claim is exclusive unless the ask's kind allows a race, so a second claimant hears `AskFull`, and a claim lives only while its claimant pushes: by default it is warned after 2 hours and lapses after 24 without a push. Each project is one Durable Object and each pushed answer runs in a Workflow of its own, so answers to different asks are merged and checked in parallel; only the final write to `main` waits, in a landing slot that holds one answer at a time. The platform never rebases an answer: when `main` moved while it waited, it merges the answer three ways onto the new `main` and checks the merged tree again, up to three times (`maxRemerges` in `packages/project/src/landing.ts`). When that merge conflicts, or `main` keeps moving, the answer is refused `StaleBase`, and a conflict's refusal names each conflicting path with the landing, ask and person that moved it. A migrate ask whose old name is used in several modules opens as a family: one child ask per module, each claimed on its own, plus a delete child that waits until every other child has landed. What an agent carries from one push to the next is kept by the platform, not in its context: each push is a numbered round with its own verdict, each refusal is a typed value with the command to run next, and `myr evidence` returns a failing lane's log to the answer's claimant.

Measured live on the `dev-oscabriel` stage on 2026-10-08, from commits `25a727e` (swarm run 1) and `6730a0e` (the rest), with [`scripts/swarm.ts`](scripts/swarm.ts) and `smoke --loop`; the whole record, failures included, is in [examples/swarm-run-2026-10-08.md](examples/swarm-run-2026-10-08.md).

| Run | Measured |
| --- | --- |
| Swarm run 2: six contributors on four harnesses (Claude Code, OpenCode, Amp, pi), one family child each | 6 of 6 landed in 7 min 41 s; one `StaleBase` landed on its second attempt, one `ChecksFailed` landed after a fix |
| Both swarm runs' ten landings | 6 of 10 met a moved `main` and were merged and checked again before landing |
| The core loop, five runs | 5 of 5 passed, each refused `OutOfScope` in git's output before it landed |
| The Lander's land step, ten swarm landings | median 5.5 s, worst 12 s: over the 5 s bar in 5 of 10 |

## Quick start

You need Bun 1.4.2 and git 2.5x. Nothing here needs an account:

```sh
bun install --frozen-lockfile
bun run verify                      # lint, types and every test, the whole core loop in Node with real git
bun run --cwd apps/web dev          # the web over a dev world seeded with two fictional projects
bun run seed -- --world node        # both examples, seeded onto a platform running in Node
```

The CLI comes from the platform itself: the web at `https://myr.technology` serves the installer, and `myr login` signs you in to the platform at `https://git.myr.technology` through the browser and sets up git's credential helper, so plain `git clone` and `git push` work:

```sh
curl -fsSL https://myr.technology/install.sh | sh
myr login
myr asks --project oscabriel/datekit
myr claim <ask> --project oscabriel/datekit
```

The web's `/docs` holds the guides and the full reference; `/llms.txt` and `myr mcp` serve the same to agents.

## Deploy your own

You need a Cloudflare account on Workers Paid, with Artifacts, and Docker with buildx. Sign-in mails codes from `no-reply@myr.technology` through Cloudflare Email Service, so onboard the brand's domain for Email Sending on the account (Compute › Email Service). Add a `dev-<you>` stage to `infra/stages.ts` and each app's `wrangler.jsonc`, set the credentials `infra/.env.schema` names, then:

```sh
bun run bootstrap -- --stage dev-<you>   # makes the stage's resources; deletes nothing
bun run deploy -- --stage dev-<you>      # runs verify, deploys the three Workers, runs smoke
```

[AGENTS.md](AGENTS.md) covers secrets, smoke, seeding, releases and teardown, and its principles table names the check that holds each rule.

### Observability

Each stage keeps, for every invocation of all three Workers and unsampled:

- **Logs**: one JSON object per line, its ids (`project`, `requestId`, `lane` and the rest) fields to filter on, in Workers Logs. A typed refusal is the product working and is never logged as an error; a defect is logged once, at error level, with its stack.
- **Issues**: exceptions, failed invocations and error-level lines, grouped; each line keeps its ids.
- **Traces**, in all three. The runtime's own spans record each Durable Object SQL statement's bound values and each fetch's full URL, so the platform's traces hold the Project Durable Object's layer rows and sealed values (never a plain value). They stay in the account's own trace store, kept seven days: the platform's traces have no export destination, and no Issues automation sends them anywhere.
- **Query strings**, unredacted, so `?service=` on git and `?since=` on watch stay readable. A sign-in callback's one-time `code` and `state` show too.
- **Source maps**, uploaded by each deploy. Cloudflare remaps an uncaught exception's stack with them, but a defect the platform reports itself is logged as thrown, minified, and by its name and frames alone, never its text. To read its frames, build the deployed commit's map with `bunx wrangler deploy --dry-run --outdir <dir> --env <stage>` in `apps/platform`.
- **Metrics**: landings, refusals by tag and stage, checked lanes, the wait before checks and draft rounds, written by the platform's `METRICS` binding to the stage's Workers Analytics Engine dataset, `metrics_<stage>` with `_` for `-`. `packages/project/src/metrics/binding.ts` lays out its columns.

A Checker container's own logs are off, since held-back checks run there; the Lander's are on. Nothing the code itself logs, traces or counts names a layer, a held-back check, a path or a value (principle 7); only the runtime's own platform spans above do.

Read them in the dashboard, under each Worker's Observability tab and under Issues, or through the SQL API with `bun run ops`. Its token needs Account › Account Analytics › Read, and so does smoke: after a deploy it fails on any exception or error-level line the stage's Workers logged since the first upload, naming each Worker and its count.

```sh
# Errors by Worker since an instant
bun run ops -- analytics sql post --scope-account-tag <account id> \
  --time-range-start 2026-10-13T00:00:00Z \
  --query "SELECT scriptName, count() AS errors FROM logs.workersLogs WHERE scriptName IN ('platform-prod', 'sandbox-prod', 'web-prod') AND (level = 'error' OR error != '') GROUP BY scriptName"

# Refusals by tag and stage
bun run ops -- analytics sql post --scope-account-tag <account id> \
  --query "SELECT blob2 AS tag, blob3 AS stage, count() AS refusals FROM events.analyticsEngine.\"metrics_prod\" WHERE blob1 = 'Refused' GROUP BY tag, stage ORDER BY refusals DESC"
```

`bun run ops -- analytics sql introspection get --account-tag <account id> --include-columns --include-wae` lists the datasets and their columns.

### Alerts

Each stage has six alerts, declared in `infra/alerts.ts` as Cloudflare Custom Alerts (beta), each a SQL API query run every minute:

- **errors**, one per Worker: five or more exceptions or error-level lines in 15 minutes.
- **issue spike**: the stage's Workers report Issues three standard deviations above the two hours before, as after a bad deploy.
- **container failures**: three or more sandbox jobs whose container never answered, in 30 minutes.
- **refusal spike**: refusals, from the stage's metrics dataset in Analytics Engine, three standard deviations above the six hours before.

No API takes a custom alert's query yet, so a person makes each by hand, once per stage, and again when `infra/alerts.ts` changes:

1. Run `bun run bootstrap -- --stage <stage> --dry-run`. It ends by printing each alert's name, detection and SQL for that stage.
2. In the dashboard, under Notifications, create a Custom Alert for each: its name, the printed SQL as custom SQL, the Automatic time range, the detection and windows printed beside it, the default execution and repeat intervals, and the address `ALERT_EMAIL` names (`infra/.env.schema`) as its email destination.

## The tree

```
apps/        the platform, sandbox and web Workers, and the CLI
packages/    the protocol (one schema for every surface), gate, rules, checks, lifecycles, git and the rest
infra/       bootstrap, deploy, the stage table, teardown
scripts/     brand and byte checks, seed, smoke, swarm, release
examples/    datekit and burrow, fictional projects seeded on dev stages, and the swarm's run record
tools/       the vendored lint plugins
```

## Credits

Files ported from other projects name their upstream in their first line and carry its licence notice; vendored folders keep their licence file beside them.

- **varlock** ([dmno-dev/varlock](https://github.com/dmno-dev/varlock), MIT): the `.env.schema` format, and the leak scanner in `packages/visibility/src/leak-scan.ts`.
- **Rat Stack** ([joelhooks/rat-stack](https://github.com/joelhooks/rat-stack), MIT): the CLI and MCP projections in `packages/protocol/src/{cli,mcp}.ts`, the Effect diagnostics map, and burrow's `no-module-level-mutable-state` rule.
- **anti-slop** ([dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), MIT): the lint plugins in `tools/oxlint/anti-slop/`.
- **shadcn/ui** (MIT): the web's base components, in `apps/web/src/components/ui/`.
- **IBM Plex Sans** and **IBM Plex Mono** (SIL Open Font License): the web's typefaces, installed from fontsource (`@fontsource-variable/ibm-plex-sans`, `@fontsource/ibm-plex-mono`), each package carrying its licence.
- **Pierre** (`@pierre/diffs`, `@pierre/trees`, Apache-2.0), **unified** (MIT), **Effect** and **isomorphic-git**: highlighting and diffs, Markdown, the whole codebase, and git inside a Worker.
- Ideas, no code: Cloudflare's cf (one command catalog), Ghostty's `VOUCHED.td` format and Matt Pocock's agent-brief shape.

Licensed under the terms in [LICENSE](LICENSE).
