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

Around the loop:

- **A web built as the gate's control room.** Every page sits in one shell: a rail of where you are (the site's sections, the projects with their posture, the project's sections), the page, and an inspector of the typed facts of the thing in hand (its state, whose move it is, who may take it, the gate, the claim, the family, the provenance), each with its next command numbered to copy. Lists are rows: select one, with a click or `j`/`k`, and its facts and claim command fill the inspector; a split family is one row with its children drawn as a fan that marks each landing as it happens. Below 1120 px the rail opens from a Menu and the facts follow the page's head, and phones get a bottom bar; Today is built to clear on a phone, one tap a choice with its consequence said under it. Pages arrive with their rows in the server's HTML and move without reloading, `?` lists the keys (`j`/`k`, `J`/`K`, `1`-`9` to copy a numbered command, and a switch that turns them off), and colour still means state, always beside its word and mark ([ADR 0022](docs/adr/0022-the-web-is-a-control-room-shell.md), [ADR 0023](docs/adr/0023-links-are-the-routers-and-lists-render-on-the-server.md)).
- **A code browser on the web.** A full-viewport app inside the shell: the file tree stays in the rail across files, with a Code | Why toggle on each file, highlighted code with `#L` line links, raw bytes served under a sandboxing CSP, the landings by day, each commit's diff (unified or split, with its stats by territory and tests) and one refs page (main, tags and claim forks; a monorepo's tags grouped by package, each package's newest first). The server sends each file and diff as plain text at the drawing's exact size, so highlighting lands in place. A project's home is its asks, then its README, rendered as GitHub-flavoured Markdown with links and images pointing into the repo at the commit, in the server's HTML so a crawler or `curl` reads it too. Every page names the commit it shows, so any page is a permalink.
- **Why each line is there.** A file's why page attributes each line to the landing that put it on `main`, naming its ask, answer, people and verdict, or the ask an opening opened. Imported history reads "before adoption". Why and a file's history are kept by commit in an R2 bucket, so every isolate reads them back ([ADR 0020](docs/adr/0020-code-history-is-kept-by-immutable-ids.md)): on the dev stage's imports (changesets, click; 200 commits of history) a first view took 5.3 to 7.7 s, down from 18.6 to 39.6 s, and a view already kept answers in under a second.
- **Asks drafted for a want.** A member proposes a want with `--draft` (or the web's propose form). The platform's agent, a Workers AI model, drafts the ask file and its failing test, runs them red first on the Checker, and puts the draft to a decider with its evidence. Nothing lands until a decider accepts, and the landing discloses the agent with `Assisted-by` ([ADR 0018](docs/adr/0018-asks-are-drafted-in-a-workflow-and-put-to-a-decider.md)).
- **A Policy page.** Who decides which paths, who is vouched for or denounced, each layer's readers, writers and disclosure, and the caps, budget and claim timing, all read from the config folder at the landed commit. It has no edit control: these change by landing a change to the config folder. A project whose config has not evaluated says why (no config folder, or one that failed) and what makes it evaluate; `myr policy` prints the same as text.
- **The platform's own front page.** The platform's `/` says what the host serves (clone URLs, MCP, agent skills, sign-in, the CLI and the web app), in HTML for a browser and as Markdown for an agent.
- **A For agents page.** The web's `/agents` (and `/agents.md`) is a reference in the voice of a man page: a Synopsis of the CLI's commands, Connect (remote MCP for Claude Code, Cursor and VS Code, MCP over stdio, the CLI, a prompt for any agent, and the skills), the Endpoints an agent reads, the Limits, and every Refusal. Its MCP entries are the same text the plugin bundles carry.
- **Markdown on every list page.** `/` and each project's page answer `Accept: text/markdown` with the text of `/llms.txt` and the project's `llms.txt`, and their HTML links to it.
- **`/llms-full.txt`.** Beyond the index at `/llms.txt`: every refusal with its repair, how git meets the platform, how a landing happens, every event a watcher hears, and short guides. The index names it in its first sentence, and a project's `llms.txt` and each ask's Markdown open with a line pointing to both.
- **The code over MCP.** An agent with no shell, such as a hosted connector, browses a project's code with five capped MCP tools: `readTree`, `readFile`, `log`, `why` and `listRefs`.

The web reads code only through public contracts the platform serves ([ADR 0019](docs/adr/0019-the-web-reads-repos-through-public-contracts.md)). On the dev stage, eight open-source repos are imported and kept for previewing it: anyhow, ky, gum, click, awesome, changesets, stb and fuzzel.

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

`vite dev` resolves the web's `#backend` import to `apps/web/src/dev/backend.ts`: every contract served in process over memory adapters, seeded with the two fictional example projects, `examples/datekit/` and `examples/burrow/`. It answers on `http://127.0.0.1:3032`, pinned in `apps/web/vite.config.ts`; a `CADDY_DEV_HOST` in the gitignored `apps/web/.env` also lets a reverse proxy serve it under that name, with hot reload over `wss`. `/auth/dev?handle=ines-v` signs you in as datekit's fictional decider.

To see every state a page can draw (each outcome, a family's fan mid-way, every kind of decision, a sealed ledger, a set env value, drafted proposals), add the dev fixtures: a fictional project, `vellum`, told as a story through the same service, and six small projects beside it. `live` also lands one family child about 20 s after a vellum page first reads it, so a page open on it shows the landing as it happens:

```sh
VITE_DEV_FIXTURES=1 bun run --cwd apps/web dev
VITE_DEV_FIXTURES=live bun run --cwd apps/web dev
```

With the fixtures running, `WEB_URL=http://127.0.0.1:3032 bun run --cwd apps/web e2e -- a11y.e2e.ts` runs axe and a keyboard walk over every page in both colour schemes at 1440 and 390 px (it loads axe from cdnjs at run time).

The CLI from source, against that dev world:

```sh
MYR_URL=http://127.0.0.1:3032 bun apps/cli/src/bin.ts projects
MYR_URL=http://127.0.0.1:3032 bun apps/cli/src/bin.ts asks --project datekit
MYR_URL=http://127.0.0.1:3032 bun apps/cli/src/bin.ts ask format-ordinal --project datekit
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

8. Run the whole core loop on a dev stage, through the CLI and git: a throwaway project `smoke-<run>`, an ask opened red first, an answer refused `OutOfScope`, then the fix landed with its trailers and its verdict note. It makes the project as the operator and answers as `bram` (`--as` names another), so it needs both tokens; it refuses `demo`, whose front page the video shows:

   ```sh
   ./node_modules/.bin/varlock run --path apps/platform/ -- bun scripts/smoke.ts --stage dev-<you> --loop
   ```

`infra/stages.md` lists every resource a stage owns, the secrets, and how a person tears a stage down by hand; no script deletes a stage's own resources. Every throwaway a smoke loop, a swarm run or a `seed --as` copy makes is recorded in `infra/created.jsonl`. `bunx varlock run --path infra/ -- bun infra/teardown.ts` prints which of them still exist, and adding `--apply` deletes exactly those.

### Install the CLI

The platform serves the CLI itself: the install script and the linux-x64 and darwin-arm64 binaries come from the stage's own `releases-<stage>` bucket:

```sh
curl -fsSL <origin>/install.sh | sh
myr login --url <origin>
```

`<origin>` is a stage's platform or web. The binaries never come from a code host's release page. `bun run release -- --build --version <semver>` builds them, and `bun run release -- --upload --stage dev-<you> --version <semver>` fills the stage's bucket. The build stamps the version `myr --version` prints: the release passes its `--version` to the CLI's own build, `bun run --cwd apps/cli build -- --version <semver>`, and a build given none prints `0.0.0`. Once the npm package `@myr/cli` is published, `npm install -g @myr/cli` is the other way in.

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
Every number below was measured live on the `dev-oscabriel` stage on 2026-10-08 (UTC), on the Workers deployed from commit `c7b68ff`. The runs started from commits `25a727e` and `6730a0e`, which change only the swarm's own scripts. The bars are the platform's own: a check of a small repo in under 60 s (S3), and a landing in under 5 s (S6). A number that misses its bar says so.

**The core loop** (`dev-oscabriel`, 2026-10-08, 16:48 to 16:59 UTC): five runs of `bun scripts/smoke.ts --stage dev-oscabriel --loop`, and all five passed. Each run makes a throwaway project, opens an ask red first, claims it, pushes outside the ask's territory and is refused with `OutOfScope` in git's output, then pushes the fixed answer, sees it land, and reads its verdict note.

| Step | Median | Worst | Bar |
| --- | --- | --- | --- |
| people: who each token names | 2.6 s | 2.9 s | none |
| init: the project made and its first commit pushed | 23.4 s | 24.5 s | none |
| open-ask: the ask's check red twice on main | 21.9 s | 23.5 s | S3 (60 s): met |
| claim | 4.4 s | 9.9 s | none |
| out-of-scope: the push refused in git's output | 6.6 s | 10.6 s | none |
| answer: the fixed push taken | 5.1 s | 5.5 s | none |
| landing: from the push taken to main moved | 32.9 s | 91.9 s | S6 (5 s): **missed**; see the next table |
| verdict-note | 2.1 s | 2.6 s | none |
| the whole loop | 99.6 s | 162.6 s | none |

The landing step holds the whole asynchronous verdict: the Answer workflow merges the answer onto main (7 to 14 s), runs its checks (2 to 4 s, under S3's bar) and has the Lander land it. In the run that took 91.9 s, the workflow started 66 s after the push was taken. The Lander's own step, read from the Answer workflow's steps in whole seconds:

| The Lander's land step (`dev-oscabriel`, 2026-10-08) | Median | Worst | Bar |
| --- | --- | --- | --- |
| the core loop's 5 landings | 6 s | 9 s | S6 (5 s): **missed** in 4 of 5 |
| the swarm's 10 landings | 5.5 s | 12 s | S6 (5 s): **missed** in 5 of 10 |

**The six-agent swarm** (`dev-oscabriel`, 2026-10-08): `bun run swarm -- --stage dev-oscabriel --project burrow-swarm-<n> --scenario video`, six contributors on four harnesses, each on one child of a fresh copy of burrow's split family. Run 1 started at 16:31 UTC; 4 of 6 landed, the last 3 min 42 s after the start. Run 2, the one retry, started at 16:40 UTC after a fix to the swarm's clone; 6 of 6 landed, the last 7 min 41 s after the start. Time is from the contributor's claim to the end of their run. Refusals counts what the contributor's `myr status` shows. A push refused in git's own output is not an answer there, so it is not counted: in run 2, tamsin also met one `OutOfScope` in git, after rebasing onto the new main.

| Run | Contributor | Harness and model | Outcome | Attempts | Refusals | Time |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | wren | Claude Code, claude-opus-5-5 | landed | 1 | none | 93 s |
| 1 | tamsin | OpenCode, openai/gpt-5.5 | **failed**: the ChatGPT account's usage limit | 1 | none | 5 s |
| 1 | ivo | Amp, medium | **failed**: cloned its fork before the platform had made it | 0 | none | 6 s |
| 1 | marisol | pi, opencode-go/kimi-k3 | landed | 1 | none | 198 s |
| 1 | dagny | pi, opencode-go/glm-5.3 | landed | 1 | none | 234 s |
| 1 | pell | pi with the adapter, opencode-go/qwen3.8-flash | landed | 1 | none | 228 s |
| 2 | wren | Claude Code, claude-opus-5-5 | landed | 1 | none | 86 s |
| 2 | tamsin | OpenCode, opencode-go/gpt-6-luna | landed | 2 | `StaleBase` ×1 | 466 s |
| 2 | ivo | Amp, medium | landed | 1 | `ChecksFailed` ×1 | 154 s |
| 2 | marisol | pi, opencode-go/kimi-k3 | landed | 1 | none | 209 s |
| 2 | dagny | pi, opencode-go/glm-5.3 | landed | 1 | none | 257 s |
| 2 | pell | pi with the adapter, opencode-go/qwen3.8-flash | landed | 1 | none | 307 s |
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
| A deploy names its stage, runs `verify` first and smoke after, and none runs while a take is recorded (`bun infra/recording.ts on`). | `packages/config/test/deploy.test.ts`, `packages/config/test/recording.test.ts` |
| Teardown deletes only the throwaways the ledger records, never a stage's namespaces, the seeded examples or their forks, or anything in `witness`, and never while a take is recorded. | `packages/config/test/teardown.test.ts` |
| Every path and command in this README exists. | `packages/config/test/readme.test.ts` |

What it does not promise:

- **Held-back checks are hidden from people and agents, not from the code under test.** They run in the check job's own container with the network off, nothing they or the lanes beside them print comes back, and a claim, or a person in one area, may fail an area only a few times each week. That raises the cost of reading them; it cannot stop a determined reader whose code runs beside them. The `Held-back:` trailer names each area, how many of its sealed checks passed and the suite's commitment, nothing more.
- **Verdicts after the push are asynchronous.** Custody and shape refusals arrive in `git push`; the merged-tree checks report through `myr status`, `myr verdict`, MCP, the web, and a git note on the answer's head ([ADR 0015](docs/adr/0015-submitting-an-answer-is-asynchronous.md)).
- **No numbers but the table's.** The Numbers section holds only what a live run measured, each with its stage and date.

## Keep or cut

The cut lines, as built, in the order they go when time runs short (the first row first). A cut that follows this section is safe by default ([AGENTS.md](AGENTS.md)).

A cartridge is a cut line removed by deletion. Visibility is the one plugged in by a marked line in `apps/platform/src/cartridges.ts`, and the one whose cut has been rehearsed: the visibility build's own integration deleted it in a scratch worktree, 103 files changed and 18,364 lines deleted, and `bun run verify` stayed green. The other rows list the files a cut deletes and the callers it edits, and none of those cuts has been rehearsed.

| Cut line | What goes | What removes it |
| --- | --- | --- |
| 1 | Asks drafted by the platform's agent (`propose --draft`, `ask draft`, `proposal`; a proposal without a draft still goes to a decider) | `packages/drafting/`, `packages/project/src/draft-runs.ts`, `packages/project/test/{drafting.model,draft-settle,rehearse}.test.ts`, `apps/platform/src/workflows/draft-steps.ts`, `apps/platform/src/adapters/draft-runs-workflow.ts`, `apps/platform/test/workflows/draft.test.ts`; the `ai` binding, `DRAFT_MODEL` and `DRAFT_LIMIT` lines in `apps/platform/wrangler.jsonc` (then `bun run --cwd apps/platform types`) and their decode in `apps/platform/src/platform.ts`; the web's `apps/web/src/routes/$project/proposals/`, `apps/web/src/features/{propose,proposal}/`, `apps/web/src/client/{propose,proposal}.ts` and their tests; the `draftAsk` and `showProposal` handlers in `apps/platform/src/handlers.ts` and `apps/web/src/dev/handlers.ts`, and `proposeAsk`'s `draft` branch |
| 1 | Today full-screen at a terminal, `myr today --tui` (`myr today` goes back to the contract's projected command, which prints the same) | `apps/cli/src/tui/`, `apps/cli/test/tui/`, the `@opentui/*` lines in `apps/cli/package.json`; `today` in `wrapped`, `entries` and `Every` in `apps/cli/src/surfaces.ts`, its row in `packages/agent-kit/src/command-doc.ts` and its word in `packages/agent-kit/test/command-doc.test.ts` |
| 1 | Agent extras: the Markdown ask page, per-project well-known skills, and `myr schema` | `apps/web/src/features/ask/markdown.ts`, `apps/web/test/ask-markdown.test.ts`; `packages/agent-kit/src/well-known.ts`, `apps/platform/src/well-known.ts`, `apps/platform/test/well-known.test.ts`, `apps/web/src/routes/[.]well-known/agent-skills/$.ts`; `apps/cli/test/schema.test.ts` and the `schema` command in `apps/cli/src/surfaces.ts` |
| 1 | The For agents page (the plugin bundles keep their MCP entries) | `packages/agent-kit/src/agent-setup.ts`, `packages/agent-kit/test/agent-setup.test.ts`, `packages/agent-kit/test/golden/agent-setup.txt`, `apps/web/src/routes/agents.tsx`, `apps/web/src/routes/agents[.]md.ts`, `apps/web/src/features/agents/setup-page.tsx`, `apps/web/test/agents.test.tsx`; its entry in the rail's sections in `apps/web/src/features/shared/shell/rail.tsx`, in the phone's More sheet in `apps/web/src/features/shared/shell/overlays.tsx` and its crumb in `apps/web/src/features/shared/shell/sections.ts`, with their cases in `apps/web/test/shell.test.tsx`, and the two routes' rows in `apps/web/test/routes.test.ts`. `agents` may stay reserved in `packages/protocol/src/ids.ts` |
| 1 | The single-key shortcuts and the keys dialog (every key's pointer twin stays: rows are links, files are the tree's rows, commands have copy buttons) | `apps/web/src/features/shared/keys.tsx`, `apps/web/src/features/code/file-keys.ts`, `apps/web/test/keys.test.tsx`; the keys dialog in `apps/web/src/features/shared/shell/overlays.tsx` and the Keys button in `apps/web/src/features/shared/shell/rail.tsx`; the calls to its hooks (`useListKeys`, `useFileKeys`, `useNumberedCommand`, `useCopiedCommand`, `useEscapeClears`) and its provider in `apps/web/src/features/shared/{row,command,copy-action}.tsx`, `apps/web/src/features/shared/shell/{app-shell,context-bar,facts-sheet,workspace}.tsx`, `apps/web/src/features/shared/shell/selection.ts`, `apps/web/src/features/code/file-header.tsx`, `apps/web/src/features/today/today-page.tsx`, `apps/web/src/routes/$project/decisions/$decision.tsx` and `apps/web/src/routes/$project/tree/-rail-body.tsx` |
| 1 | The dev fixtures (the default dev world and every test that seeds it are unchanged; nothing of them reaches a production build) | `apps/web/src/dev/fixtures.ts`, `apps/web/src/dev/fixtures/`, `apps/web/test/dev-fixtures.test.ts`, the `fixtures` option in `apps/web/src/dev/{backend,server,world}.ts`, and `apps/web/e2e/a11y.e2e.ts`, whose pages are the fixtures' |
| 2 | The kept posture (each list reads every listed project's posture again, as ADR 0021 had it) | `packages/project/src/projection-d1/postures.ts`, its table's lines in `packages/project/src/projection-d1/tables.ts` and its deletes in `packages/project/src/projection-d1/projection.ts`, its line in `apps/platform/src/ports.ts` and in the `/` route's services in `apps/platform/src/surfaces.ts`, and their cases in `packages/project/test/projection-d1.test.ts` and `apps/platform/test/{front-page,home,posture-listing}.test.ts`; `apps/platform/migrations/0005_standing_postures.sql` may stay, since an unused table costs nothing. Going further, `packages/project/src/standing-posture/memory.ts` and the store half of `packages/project/src/standing-posture.ts` with `packages/project/test/standing-posture.test.ts`'s store cases |
| 1 | `/llms-full.txt` and the banner atop each Markdown answer | `packages/agent-kit/src/full-llms.ts`, `packages/agent-kit/test/full-llms.test.ts`, `packages/agent-kit/test/golden/full-llms.txt`, `apps/web/src/routes/llms-full[.]txt.ts` and its cases in `apps/web/test/llms.test.ts`; `refusalCatalog` in `packages/agent-kit/src/refusals.ts`; `indexBanner` and the index's link to the file in `packages/agent-kit/src/host-doc.ts` (then regenerate `packages/agent-kit/test/golden/host-doc.txt`), the banner in `apps/web/src/features/ask/markdown.ts` with its cases in `apps/web/test/ask-markdown.test.ts`, the re-exports in `apps/web/src/features/agents/llms.ts`, and its row in `apps/web/test/routes.test.ts` |
| 1 | The pi adapter | `apps/cli/src/pi.ts`, `apps/cli/test/pi.test.ts`, its entry and its `neverBundle` line in `apps/cli/tsdown.config.ts`, the pi dev dependency in `apps/cli/package.json`, and the adapter's line in the package manifest's `pi` key in `scripts/lib/release.ts` |
| 2 | Why each line is there, on the web (the file toolbar's Why link goes) | `packages/git/src/blame.ts`, `packages/git/src/line-diff.ts` (with `tree-diff.ts` keeping its own diff), `packages/git/test/{blame,line-diff}.test.ts`, `packages/project/src/code/why.ts`, `packages/project/test/code-why.test.ts`, `whyOf` in `packages/project/src/code.ts`, the `why` contract's handlers, `apps/web/src/routes/$project/why/`, `apps/web/src/features/why/`, `apps/web/src/client/why.ts`, `apps/web/test/why.test.tsx`, `apps/web/e2e/why.e2e.ts` |
| 2 | Code history kept across isolates (each isolate walks why and a file's history again, as it did before; nothing else changes) | `packages/project/src/code-store/binding.ts` and its R2 cases in `packages/project/test/code-store.test.ts`; the `CODE_CACHE` bucket in `apps/platform/wrangler.jsonc` (then `bun run --cwd apps/platform types`), its decode in `apps/platform/src/platform.ts`, its `CodeStoreR2` line in `apps/platform/src/ports.ts`, its line in `apps/platform/test/fake-env.ts` and its rows in `apps/platform/test/bindings.test.ts` and `apps/web/test/env.test-d.ts`; `codeCache` in `infra/stages.ts` and its rows in `packages/config/test/bootstrap.test.ts`. Going further, `packages/project/src/code-store.ts`, `packages/project/src/code-store/`, `packages/project/src/code/history.ts`, `packages/project/test/code-history.test.ts` and the store's `CodeStore` line in `apps/platform/src/surfaces.ts` go too, which edits `nearestKept` and its callers out of `packages/project/src/code/{why,log}.ts` |
| 2 | A README rendered as Markdown (it shows as plain text instead) | `apps/web/src/features/markdown/`, `apps/web/test/markdown.test.tsx`, `apps/web/test/markdown-resolve.test.ts`, and the `react-markdown`, `remark-gfm`, `rehype-*` and `@tailwindcss/typography` lines in `apps/web/package.json` |
| 3 | The Policy page | `apps/web/src/routes/$project/people.tsx`, `apps/web/src/features/project-people/`, `apps/web/src/client/policy.ts`, `apps/web/test/project-people.test.tsx`, `apps/web/e2e/people.e2e.ts`, its section in `apps/web/src/features/shared/shell/sections.ts`, and the project home's Who decides block, which reads the same policy, in `apps/web/src/features/project/project-page.tsx` |
| 2 | `myr why`, verdicts as git notes, and the `ReachedInternals` stage | `apps/cli/src/local/why.ts`, `apps/cli/test/local/why.test.ts`; `packages/git/src/notes.ts`, `apps/platform/src/workflows/notes.ts`, `packages/git/test/notes.test.ts`, `apps/platform/test/notes.test.ts` (verdicts still reach `status`, `verdict` and MCP); `packages/gate/src/imports.ts`, `packages/gate/test/imports.test.ts` and its branch in `packages/gate/src/stages/shape.ts` |
| 2 | The null-answer codemod: a check that passes against an answer whose exports do nothing is `WeakCheck` (built and tested; no ask runs it yet, since it needs a third check run and a step in the Checker's image) | `packages/checks/src/null-answer.ts`, `packages/checks/test/null-answer.test.ts`, `packages/checks/test/fixtures/null-answer/`, and its `./null-answer` export and `ts-morph` line in `packages/checks/package.json` |
| 3 | Garden's Promote: a finish repeated across answers becomes a proposed `lintToZero` ask behind one decision (built and tested; no landing calls it yet, since no finish carries the rule it names) | `packages/project/src/attention/promote.ts`, `packages/project/test/attention/promote.test.ts` |
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
  agent-kit/    generated agent files: the project skill, the AGENTS.md block, hooks, the command list, the host's front page
  drafting/     the platform's agent: drafts an ask from a want through Workers AI, the ask file rendered by code
  testkit/      scenario builders, golden git transcripts, process fakes
  brand/        the name, and every identifier made from it
  config/       the vitest preset and the repo's own tests
infra/          bootstrap, deploy, the recording lock, the stage table, smoke's probes, teardown
scripts/        brand and byte checks, seed, smoke, swarm, release
examples/       datekit and burrow, fictional projects for the demo
tools/oxlint/   the vendored anti-slop lint plugins
docs/           decisions (adr/), agent conventions (agents/), the demo (demo/)
```

Every internal package is `@repo/<name>`, and in code the product's name lives only in `packages/brand/src/index.ts`. Every operation is one contract in `packages/protocol/src/contracts.ts`, and the CLI, MCP and the web are projections of it, built in each app's `surfaces.ts`.

### Three Workers, and who holds what

| Worker | Holds | Reached by |
| --- | --- | --- |
| `platform` | `ARTIFACTS` (the public namespace) and `ARTIFACTS_PRIVATE` (layer repos), the `PROJECT` Durable Object, the `ANSWER` and `ON_PUSH` Workflows, the `FRONT_PAGE` database, `OAUTH_KV`, the `EVIDENCE`, `RELEASES` and `CODE_CACHE` buckets, `LOADER` (a Worker Loader for config code), `AI` (Workers AI, for drafting asks), the `SANDBOX` service, rate limits, the push-event trigger and every secret | git, the CLI, MCP clients and the web |
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

Artifacts, the git storage under every repo, has no atomic multi-ref push, so `main` lands by itself, with a non-force push that fails if `main` moved (a compare-and-swap), and the bookkeeping refs (the landed mirror and the notes) follow in pushes of their own. The Project Durable Object's landed SHA is the truth. Any write token can force-push `main`, so a canonical repo's write tokens never leave the platform's own jobs: answers go to forks through the gateway, and only the trusted Lander, which runs no answer code, gets a write token on a canonical repo, for five minutes, inside a landing. Events fire once per pushed ref, the platform's own bookkeeping pushes included, so `OnPush` recognizes those and ignores them. The binding resolves only short branch names and commit SHAs, so the Durable Object keeps the SHAs of custom refs itself ([ADR 0014](docs/adr/0014-landing-is-a-cas-push-of-main-then-bookkeeping-refs.md)).

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
- **Pierre** (`@pierre/diffs` and `@pierre/trees`, Apache-2.0). The web's highlighted files, diffs and file tree, drawn in the browser.
- **unified** (`react-markdown`, `remark-gfm`, `rehype-raw`, `rehype-sanitize`, `rehype-slug`, MIT). A README rendered as GitHub-flavoured Markdown, sanitized with GitHub's allow-list.
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
