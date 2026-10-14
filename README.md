# Myr

A Git platform for the boundary between a project and everyone else. Everything a project ships is public, its contribution process is typed code on `main`, and a push lands only by passing a typed gate.

Anyone's agent can now offer a change at any hour, and projects answer by closing the door or hand-building a vouch gate in front of it. Myr puts that boundary in the platform, so it is held at the push rather than in a maintainer's evening. It runs live at <https://myr.technology>.

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
myr login --url https://git.myr.technology
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
examples/    datekit and burrow, fictional projects seeded on dev stages
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
