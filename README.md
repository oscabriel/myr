# Myr

A Git platform for the boundary between a project and everyone else. Everything a project ships is public, its contribution process is typed code on `main`, and a push lands only by passing a typed gate.

## The front door broke

Open source had one front door: anyone could offer a change, and a maintainer would read it. Now anyone's agent can offer one at any hour, and projects answer by closing the door, redirecting it to a form, or hand-building a vouch gate in front of it. Myr puts the boundary in the platform, so it is held at the push rather than in a maintainer's evening.

A platform can do what a setting on a code host cannot:

- **Judge with checks the answer cannot touch.** The files that decide what the checks do (test and lint config, scripts, CI files, the config folder, `.env.schema`, and every file the project's own run commands name) form its judge closure. A push that edits one, or adds a `.skip` or a lint disable without a reason, is refused at the push.
- **Hold checks back.** A maintainer's held-back checks run on every answer; the answerer learns one result per area, and each landing names the suite's salted commitment.
- **Refuse in git's own words.** A refusal is a member of one closed, typed union about the contribution, printed in `git push`'s `remote:` lines with the command to run next and whether retrying can help.
- **Give an ask one claimant.** A claim is an exclusive, expiring right to answer an ask, so two agents never race on the same change; racing is opt-in, for the kinds of ask where parallel attempts are the point.
- **Credit the asker too.** A landing names every person by trailer (`Asked-by`, `Signed-off-by`, `Decided-by`, `Finished-by` and more), and a person's record carries across projects. An agent is disclosed, never credited.

Contributors meet four nouns, which [GLOSSARY.md](GLOSSARY.md) defines with the rest:

- an **ask**: a file on `main` stating one change the project wants, with a territory and a check that fails on `main`;
- an **answer**: a commit in the claimant's fork, offered for one ask;
- a **check**: what judges the answer, run by the platform on the exact merged tree;
- a **refusal**: what the platform returns instead of landing.

The top half is open; the bottom half is typed. Code, asks, credit and the ledger of what a project holds back are public to everyone. The way in is a typed gate, and what it refuses is a typed value.

An answer that strays outside its ask's territory never reaches `main`. This is the screen `apps/platform/test/core-loop.test.ts` asserts, from real git (with the test's local origin written as `https://<platform>`):

```
$ git push
remote: OutOfScope: changes paths outside the ask's territory: README.md; put those files back, or flag the ask if the want needs them
remote:   next: myr check
remote:   retryable: no
To https://<platform>/datekit--parse-iso--alice.git
 ! [remote rejected] HEAD -> main (OutOfScope)
error: failed to push some refs to 'https://<platform>/datekit--parse-iso--alice.git'
```

The core loop, in six lines:

1. A decider opens an ask; `myr ask open` lands it only once its check fails on `main` twice the same way, by an assertion.
2. A contributor runs `myr claim <ask>` and gets a fork of their own.
3. They, or their agent, work in plain git with any harness, and push to the fork through the platform's gateway.
4. The gateway checks the push against the claim, the territory and the judge closure, and refuses in `git push`'s output.
5. The platform merges onto `main` and runs the ask's check, the project's checks and the held-back checks on that exact tree.
6. It lands the checked tree on `main` as its own commit crediting every person, or answers with a refusal.

## Run it

### What you need

- Bun 1.4.2 (the `packageManager` in `package.json`).
- git 2.5x. The tests drive real git, `git http-backend` included (built and tested on 2.56).
- Docker with buildx, which builds the sandbox's two container images (`apps/sandbox/images/`) during a deploy.
- For a stage of your own: a Cloudflare account on Workers Paid (Containers and Workflows need it), with Artifacts.

### On this machine, with no account

```sh
bun install --frozen-lockfile
bun run verify
```

`verify` is the gate: the lockfile, lint and format, types, every workspace's tests, `brand:check` and `bytes:check`. The tests run the whole core loop in Node with real git, a bare-repo host on disk and SQLite, with nothing outside this machine and no account.

The web, over its dev world:

```sh
bun run --cwd apps/web dev
```

`vite dev` resolves the web's `#backend` import to `apps/web/src/dev/backend.ts`: every contract served in process over memory adapters, seeded with the two fictional example projects, `examples/datekit/` and `examples/burrow/`. Open the URL vite prints; `/auth/dev?handle=ines-v` signs you in as datekit's fictional decider.

The CLI from source, against that dev world (use the port vite printed):

```sh
MYR_URL=http://localhost:5173 bun apps/cli/src/bin.ts projects
MYR_URL=http://localhost:5173 bun apps/cli/src/bin.ts asks --project datekit
MYR_URL=http://localhost:5173 bun apps/cli/src/bin.ts ask format-ordinal --project datekit
```

Both examples, seeded onto a platform that runs in Node on this machine for the length of the command, with real git:

```sh
bun run seed -- --world node
```

### On your own Cloudflare account

Wrangler deploys the three Workers; cf is our ops CLI. Cloudflare's cf can't deploy this platform yet: its config cannot declare the Artifacts push-event trigger, its deploy refuses the sandbox's container self-binding, and it would be a second deploy tool in the recording week. So Wrangler deploys, and cf runs read-mostly operations as `bun run ops -- <command>` ([ADR 0002](docs/adr/0002-wrangler-deploys-every-worker.md)).

1. Name your stage `dev-<you>`. Add it to `stages` in `infra/stages.ts`, and give it an `env` block in `apps/platform/wrangler.jsonc`, `apps/sandbox/wrangler.jsonc` and `apps/web/wrangler.jsonc`, copied from `dev-oscabriel`'s with your stage's name in its place and your own handle as `OPERATOR_HANDLE`; `packages/config/test/bootstrap.test.ts` holds the three files to the table.
2. Log Wrangler in once, and set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as `infra/.env.schema` describes (`bun run env:check` shows them, redacted):

   ```sh
   (cd apps/platform && ./node_modules/.bin/wrangler login)
   ```

3. Make the stage's resources. Bootstrap creates only what is missing and deletes nothing; it applies the database migrations and records your workers.dev subdomain in `infra/workers-dev.json`:

   ```sh
   bun run bootstrap -- --stage dev-<you>
   ```

4. Set the secrets `apps/platform/.env.schema` names, through varlock: write `NAME=varlock(prompt)` for each into the `.env.local` beside that schema, then run this in your own terminal. No value enters the repo.

   ```sh
   ./node_modules/.bin/varlock load --path apps/platform/
   ```

5. Deploy. It runs `verify` first, then deploys the sandbox, the platform (through `varlock-wrangler`, which sends the secrets) and the web, reads back the push-event trigger, and runs smoke:

   ```sh
   bun run deploy -- --stage dev-<you>
   ```

6. Seed the two examples. The seed makes each project as the operator (`OPERATOR_TOKEN`) and opens its asks as the examples' fictional deciders, so the stage's `SESSION_TOKENS` must give each of them a token; varlock hands the seed both:

   ```sh
   ./node_modules/.bin/varlock run --path apps/platform/ -- bun run seed -- --stage dev-<you>
   ```

7. Probe the stage at any time; smoke only reads:

   ```sh
   bun scripts/smoke.ts --stage dev-<you>
   ```

`infra/stages.md` lists every resource a stage owns, the secrets, and how a person tears a stage down by hand; no script deletes anything.

### Install the CLI

The platform serves the CLI itself: the install script and the linux-x64 and darwin-arm64 binaries come from the stage's own `releases-<stage>` bucket:

```sh
curl -fsSL <origin>/install.sh | sh
myr login --url <origin>
```

`<origin>` is a stage's platform or web. The binaries never come from a code host's release page. `bun run release -- --build` builds them, and `bun run release -- --upload --stage dev-<you> --version <semver>` fills the stage's bucket. Once the npm package `@myr/cli` is published, `npm install -g @myr/cli` is the other way in.

`myr login` signs you in through the browser (PKCE against the platform's own OAuth server and its own accounts) and names `git-credential-myr` in git's config for that host, so plain `git clone`, `git fetch` and `git push` work with no token in a URL.

### Contributors' harnesses

A harness needs nothing of ours to read a refusal: it arrives in `git push` output, which any harness that runs git already reads. On top of that:

- **`myr mcp`** serves the platform's tools over MCP on stdio, in all five protocol versions from 2024-11-05 to 2026-07-28.
- **Remote MCP** at `<platform>/mcp` speaks the stateless 2026-07-28 protocol, signed in through the platform's OAuth; the web's `/.well-known/mcp.json` points at it.
- **The credential helper**, `git-credential-myr`, hands git the stored token for the platform's host and never prompts. It passes the harness and model it finds in the environment (`AI_AGENT` first, then Claude Code's, Cursor's or pi's own variables) as audit metadata, which a landing discloses as `Assisted-by`; identity is only ever the person's token.
- **`myr hook <event> --json`** answers Claude Code's hooks (session start, before a tool runs, before stopping) with the gate's own policy. It fails open: the gateway stays the authority.
- **The pi package.** Once published, the package carries a `"pi"` key, so `pi install npm:@myr/cli` gives a pi agent the claim's brief, a guard before it edits the judge closure, and a verdict loop that continues at most three times.

## Numbers

<!-- numbers:begin -->
Filled from the live runs on the demo stage (804).
<!-- numbers:end -->

## What it promises and how to check

Each promise names the check that holds it, and `bun run verify` runs every one.

| Promise | How to check |
| --- | --- |
| A push outside its ask's territory is refused in git's own `remote:` lines, and the fork keeps the commit. The fixed answer lands as the platform's commit, authored by the answerer, with `Asked-by` and `Signed-off-by`; a stale answer is `StaleBase`; replaying a request lands nothing twice. | `apps/platform/test/core-loop.test.ts` |
| Refusals are one closed union of typed values, each with `retryable`, `next` and an optional `at`, and no `message`. MCP returns each one with its tag. | `packages/protocol/test/refusal.test.ts`, `packages/protocol/test/mcp.test.ts`, `apps/platform/test/mcp.test.ts` |
| One renderer writes every refusal, for git, the CLI, MCP and the web. | `packages/protocol/test/render.test.ts` |
| One push hears every shape refusal at once, not one per attempt. | `packages/gate/test/shape.test.ts` |
| An answer cannot edit the files that judge it, and a disabling marker without a reason is refused. | `packages/checks/test/judge.test.ts`, `packages/gate/test/markers.test.ts` |
| An ask opens only red first: its check fails on `main` twice the same way, by an assertion. | `packages/checks/test/red-first.test.ts` |
| `myr check` gives the gateway's shape refusals for the same commit before you push. | `apps/cli/test/local/check.test.ts` |
| The name lives in one package. | `bun run brand:check`, `packages/brand/test/leaks.test.ts` |
| Deny by default: no layer's path enters a public tree, only a layer's readers clone it, and the public web holds no Artifacts binding, private or public. | `packages/gate/test/shape.test.ts`, `packages/visibility/test/guards.test.ts`, `apps/platform/test/visibility/layer-gateway.test.ts`, `apps/web/test/env.test-d.ts` |
| Held-back checks run with egress off and only after the setup snapshot is taken, so no sealed file is ever cached; they report one result per area, with no output. | `apps/sandbox/test/held-back.test.ts`, `apps/platform/test/visibility/held-back.test.ts` |
| Nobody reads a write-only value back, and unlanded code sees only a placeholder. | `apps/platform/test/visibility/env-values.test.ts`, `apps/sandbox/test/env-injection.test.ts` |
| Rules are deterministic: config code sees the facts' clock and seed, never the wall clock. | `packages/rules/test/replay.test.ts` |
| Lifecycles are pure transitions, and model tests over generated histories hold every invariant after every step. | `packages/project/test/claim.model.test.ts`, `packages/project/test/landing.model.test.ts` |
| The web's production build carries none of the dev world. | `apps/web/test/production-bundle.test.ts` |
| Visibility plugs in by one marked line, and nothing else reaches into it. | `packages/config/test/cartridge.test.ts` |
| Each Worker's bundle stays under its byte budget. | `bun run bytes:check` |
| A deploy names its stage, runs `verify` first and smoke after. | `packages/config/test/deploy.test.ts` |
| Every path and command in this README exists. | `packages/config/test/readme.test.ts` |

What it does not promise:

- **Held-back checks are hidden from people and agents, not from the code under test.** They run in the check job's own container with the network off, nothing they or the lanes beside them print comes back, and a claim, or a person in one area, may fail an area only a few times each week. That raises the cost of reading them; it cannot stop a determined reader whose code runs beside them. The `Held-back:` trailer names each area, how many of its sealed checks passed and the suite's commitment, nothing more.
- **Verdicts after the push are asynchronous.** Custody and shape refusals arrive in `git push`; the merged-tree checks report through `myr status`, `myr verdict`, MCP, the web, and a git note on the answer's head.
- **No numbers but the table's.** The Numbers section holds only what a live run measured, each with its stage and date.

## Keep or cut

The cut lines, as built, in the order they go when time runs short (the first row first). A cut that follows this section is safe by default ([AGENTS.md](AGENTS.md)).

A cartridge is a cut line removed by deletion. Visibility is the one plugged in by a marked line in `apps/platform/src/cartridges.ts`, and the one whose cut has been rehearsed: the visibility build's own integration (issue 699) deleted it in a scratch worktree, 103 files changed and 18,364 lines deleted, and `bun run verify` stayed green. The other rows list the files a cut deletes and the callers it edits, and none of those cuts has been rehearsed.

| Cut line | What goes | What removes it |
| --- | --- | --- |
| 1 | Agent extras: the Markdown ask page, per-project well-known skills, and `myr schema` | `apps/web/src/features/ask/markdown.ts`, `apps/web/test/ask-markdown.test.ts`; `packages/agent-kit/src/well-known.ts`, `apps/platform/src/well-known.ts`, `apps/platform/test/well-known.test.ts`, `apps/web/src/routes/[.]well-known/agent-skills/$.ts`; `apps/cli/test/schema.test.ts` and the `schema` command in `apps/cli/src/surfaces.ts` |
| 1 | The pi adapter | `apps/cli/src/pi.ts`, `apps/cli/test/pi.test.ts`, its entry and its `neverBundle` line in `apps/cli/tsdown.config.ts`, the pi dev dependency in `apps/cli/package.json`, and the adapter's line in the package manifest's `pi` key in `scripts/lib/release.ts` |
| 2 | `myr why`, verdicts as git notes, and the `ReachedInternals` stage | `apps/cli/src/local/why.ts`, `apps/cli/test/local/why.test.ts`; `packages/git/src/notes.ts`, `apps/platform/src/workflows/notes.ts`, `packages/git/test/notes.test.ts`, `apps/platform/test/notes.test.ts` (verdicts still reach `status`, `verdict` and MCP); `packages/gate/src/imports.ts`, `packages/gate/test/imports.test.ts` and its branch in `packages/gate/src/stages/shape.ts` |
| 3 | Admission runs and env injection | `packages/project/src/visibility/admission.ts`, `apps/platform/src/workflows/admission-steps.ts`, `packages/project/test/visibility/admission.test.ts`, `apps/platform/test/visibility/admission.test.ts`; `apps/sandbox/src/env-gateway.ts`, `apps/sandbox/src/checker/env.ts`, `apps/sandbox/test/env-injection.test.ts` |
| 4 | Live streaming views (the pages poll every 5 s instead, as they already do when the stream fails) | `apps/platform/src/watch.ts`, `apps/platform/test/watch.test.ts`, the `ProjectSockets` entry in `apps/platform/src/ports.ts`, the `Watch` contract in `packages/protocol/src/contracts.ts` with its callers, and the stream half of `apps/web/src/client/watch.ts` and `apps/web/test/watch.test.ts`, keeping the polling |
| 4 | The D1 projection (the platform falls back to an empty memory front page) | `packages/project/src/projection-d1/`, `packages/project/test/projection-d1.test.ts`, `packages/project/test/projection-d1-credits.test.ts`, `packages/project/test/projection-d1.fixtures.ts`, `apps/platform/migrations/0001_front_page.sql`, `apps/platform/migrations/0004_projects_credits.sql`, and its entry in `apps/platform/src/ports.ts` |
| 5 | Visibility, the cartridge: layers, held-back checks, posture, the ledger, the env shape and write-only values | `packages/visibility/`, `packages/project/src/visibility/`, `packages/project/test/visibility/`, `apps/platform/src/visibility/`, `apps/platform/test/visibility/`, `apps/cli/test/local/env-set-live.test.ts`, `packages/config/test/seed-layer.test.ts`, `examples/datekit/layers/`, `packages/config/test/cartridge.test.ts`; the marked line in `apps/platform/src/cartridges.ts`; the `@repo/visibility` lines in `apps/platform/package.json` and `packages/project/package.json`; `ARTIFACTS_PRIVATE` and `MASTER_KEY` wherever they are named outside it (`apps/platform/wrangler.jsonc`, `apps/platform/.env.schema`, the env decode in `apps/platform/src/platform.ts`, the platform's test env in `apps/platform/test/fake-env.ts` and `apps/platform/test/serve-world.ts`, and their type and binding tests), with the layer rows in `packages/config/test/bootstrap.test.ts` and `packages/config/test/seed.test.ts`; then `bun run --cwd apps/platform types` |
| 6 | Never cut: the core loop, refusals in git's output, the split family the agents answer together, credit trailers, Today and the front page | `apps/platform/test/core-loop.test.ts`, `examples/burrow/`, `packages/git/src/trailers.ts`, `packages/project/src/attention/today.ts`, `packages/project/src/front-page.ts` |

## Architecture

### The tree

```
apps/
  platform/     the platform Worker: git gateway, /rpc, /mcp, OAuth, the Project Durable Object, the Answer and OnPush Workflows
  sandbox/      the sandbox Worker: the Checker (untrusted, a container per check) and the Lander (trusted git) Durable Objects
  web/          the web Worker: TanStack Start pages over the contracts, and Markdown for agents
  cli/          every contract as a command, plus login, init, check, why, mcp, hook and the credential helper
packages/
  protocol/     the one schema: branded ids, the domain, the Refusal union, the contracts (one RpcGroup), the renderer
  sdk/          what a project's config folder imports to state its process in TypeScript
  rules/        evaluates the config folder at the landed SHA into a typed policy
  gate/         the stages a push passes, cheapest first; shape refusals accumulate
  checks/       check kinds, the run-block finder, red first, the judge closure, the CheckRunner port
  project/      the claim and landing lifecycles, the project store, Today, credit, the Lander port, the D1 projection
  git/          the gateway, smart HTTP, trailers, notes, tree diffs, patch ids
  artifacts/    the RepoHost port, the only caller of Artifacts
  visibility/   the cartridge: layers, posture, ledger, guards, env shape, write-only values
  agent-kit/    generated agent files: the project skill, the AGENTS.md block, hooks, the command list
  testkit/      scenario builders, golden git transcripts, process fakes
  brand/        the name, and every identifier made from it
  config/       the vitest preset and the repo's own tests
infra/          bootstrap, deploy, the stage table, smoke's probes
scripts/        brand and byte checks, seed, smoke, swarm, release
examples/       datekit and burrow, fictional projects for the demo
tools/oxlint/   the vendored anti-slop lint plugins
docs/           decisions (adr/), agent conventions (agents/), the demo (demo/)
```

Every internal package is `@repo/<name>`, and in code the product's name lives only in `packages/brand/src/index.ts`. Every operation is one contract in `packages/protocol/src/contracts.ts`, and the CLI, MCP and the web are projections of it, built in each app's `surfaces.ts`.

### Three Workers, and who holds what

| Worker | Holds | Reached by |
| --- | --- | --- |
| `platform` | `ARTIFACTS` (the public namespace) and `ARTIFACTS_PRIVATE` (layer repos), the `PROJECT` Durable Object, the `ANSWER` and `ON_PUSH` Workflows, the `FRONT_PAGE` database, `OAUTH_KV`, the `EVIDENCE` and `RELEASES` buckets, `LOADER` (a Worker Loader for config code), the `SANDBOX` service, rate limits, the push-event trigger and every secret | git, the CLI, MCP clients and the web |
| `sandbox` | the `CHECKER` and `LANDER` Durable Objects and their containers; no Artifacts binding: each job carries a short-lived token for one repo | only the platform's `SANDBOX` binding; it has no public URL |
| `web` | `PLATFORM` (a service binding) and public vars; no storage and no secret | browsers, and agents reading Markdown |

Bindings are declared per stage in each app's `wrangler.jsonc`, and the platform decodes its whole env once, at start (`apps/platform/src/platform.ts`).

### The core loop, step by step

1. **Init or import.** `myr init` finds the project's own commands (its run block), proposes a config folder, and makes the project, empty or imported once from a public HTTPS repo. For an empty project, the initializer's first push is the only direct push `main` ever takes; after it, `main` moves only by a landing.
2. **Rules at the landed SHA.** After every landing the Lander bundles the config folder, and the platform evaluates it once, with frozen time and randomness, into a typed policy. Rules come only from the platform's own last landing.
3. **Open an ask.** A decider sends the ask and its check; the check runs on `main` twice and must fail the same way by an assertion; the platform lands the ask with `Asked-by`.
4. **Claim.** `myr claim` makes the claimant's fork (`<project>--<ask>--<handle>`). Pushes keep the claim alive; a quiet claim is warned, then lapses.
5. **Push through the gateway.** Custody admits the pusher before git sees the pack; after the fork takes it, the shape stage reads the diff (territory, judge closure, weakening markers, reached internals, layer paths) and every refusal comes back at once in `remote:` lines.
6. **Check.** The `Answer` Workflow has the Lander merge onto `main`, then the Checker runs the cheap lanes, the ask's check and the project's checks on the exact merged tree, then the held-back checks.
7. **Land.** One landing at a time per project: the Lander commits the checked tree (author the answerer, committer the platform, a trailer for each person the platform recorded in a role) and pushes `main`. A moved `main` means a re-merge and a re-check, or `StaleBase`.
8. **Backstop.** Every push event starts `OnPush`, deduplicated by the event's id. A move of `main` the platform did not make becomes a `StrayPush` decision on a decider's Today, whose default is to revert it.

Read it back with `myr status`, `myr verdict`, `myr why <path>:<line>`, the verdict note, MCP or the web.

### What the design rests on

Artifacts, the git storage under every repo, has no atomic multi-ref push, so `main` lands by itself, with a non-force push that fails if `main` moved (a compare-and-swap), and the bookkeeping refs (the landed mirror and the notes) follow in pushes of their own. The Project Durable Object's landed SHA is the truth. Any write token can force-push `main`, so a canonical repo's write tokens never leave the platform's own jobs: answers go to forks through the gateway, and only the trusted Lander, which runs no answer code, gets a write token on a canonical repo, for five minutes, inside a landing. Events fire once per pushed ref, the platform's own bookkeeping pushes included, so `OnPush` recognizes those and ignores them. The binding resolves only short branch names and commit SHAs, so the Durable Object keeps the SHAs of custom refs itself.

### Plain git, so you can leave

Export is `git clone`. Code, asks (files in the config folder), the rules (TypeScript on `main`) and credit trailers, `Decided-by` included, leave with a clone. Verdict notes need one more fetch of `refs/notes/*`, because `git clone` copies no notes:

```sh
git fetch origin 'refs/notes/*:refs/notes/*'
```

Inbound or two-way sync with GitHub is declined by design: it would be a second way onto `main` that skips the gate ([ADR 0010](docs/adr/0010-no-inbound-github-sync.md)). A project can be imported once, to start it.

### What is ours

Every app and package here is ours, except the files ported from other projects. Each of those names its upstream in its first line, and carries the upstream's licence notice in its header or in a file beside it:

- `packages/protocol/src/{cli,mcp}.ts`: the CLI-flag and MCP-tool projections, from Rat Stack;
- `packages/visibility/src/leak-scan.ts`: the leak scanner's technique, from varlock;
- `examples/burrow/tools/oxlint/burrow/rules/no-module-level-mutable-state.ts`: the fictional example's own lint rule, from Rat Stack, with `examples/burrow/tools/oxlint/burrow/LICENSE-rat-stack.txt` beside it.

Vendored folders keep their licence file beside them: `tools/oxlint/anti-slop/` (anti-slop's oxlint plugins, with `tools/oxlint/anti-slop/UPSTREAM.md`), `apps/web/src/components/ui/` (shadcn/ui's components) and `apps/web/src/assets/fonts/` (the web's fonts). Ported code is ours to change once copied, and no upstream is synced in ([ADR 0013](docs/adr/0013-provenance-copy-with-attribution.md)). The decisions behind the design are in `docs/adr/`.

## Credits

Each credit names what we took and where it lives.

- **varlock** ([dmno-dev/varlock](https://github.com/dmno-dev/varlock), MIT). Myr reads the `.env.schema` (@env-spec) format from varlock: a project's env shape is its committed `.env.schema`, parsed with `@env-spec/parser` and never resolved. The leak scanner that keeps write-only values out of logs and notes is ported from varlock's exact-match scanner (`packages/visibility/src/leak-scan.ts`), and this repo's own env runs through varlock.
- **Rat Stack** ([joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) at `fba26d8`, MIT). The projection of one Effect `RpcGroup` into CLI commands and MCP tools (`packages/protocol/src/{cli,mcp}.ts`), the shape of the Effect diagnostics map in `tsconfig.base.json`, and burrow's `no-module-level-mutable-state` rule.
- **anti-slop** ([dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22`, MIT). The oxlint plugins, generic and Effect, that lint this repo, vendored in `tools/oxlint/anti-slop/`.
- **shadcn/ui** (MIT). The web's base components, in `apps/web/src/components/ui/`.
- **Public Sans** and **JetBrains Mono** (SIL Open Font License). The web's two typefaces, self-hosted in `apps/web/src/assets/fonts/`.
- **Effect**. The product is written in Effect v4: its schemas, the one `RpcGroup`, the CLI, the MCP servers and the platform's HTTP.
- **isomorphic-git**. git inside a Worker: the in-memory repo host, the smart-HTTP pushes of the Artifacts binding adapter, and the `/isogit` Lander.
- **Cloudflare's cf** (ideas, no code). One merged command catalog for every surface (`commandDocs` in `packages/agent-kit/src/command-doc.ts`), and the rule that wire schemas use whole or finite numbers and optional keys, so the JSON Schema an MCP client reads holds no `"Infinity"` and no `null`.
- **Ghostty's `VOUCHED.td` format**. A project's vouch file: one handle per line, and a leading `-` to denounce.
- **Matt Pocock's agent-brief shape**. The brief an ask carries (the want, what happens today, the context, the terms, what is out of scope), and the ask-shaped template this repo's own work was written in, `.scratch/TEMPLATE.md`.

## Roadmap

- Later: a one-way push mirror of `main` to GitHub.
- Public REST next: an `HttpApi` projection → OpenAPI 3.1 → Forge SDKs once Forge publishes to npm.
- Infrastructure as code with Alchemy or cf, once their gates open: Alchemy when it can declare Durable-Object-managed containers, cf when its config can declare the push-event trigger and the sandbox's self-binding.
- MCP's session protocols over HTTP; stdio (`myr mcp`) serves them today.
- The embargo Workflow: embargo layers compile and show in the ledger today, and nothing releases them on schedule yet.
