# Myr

Myr is a Git platform on Cloudflare. Everything a project ships is public, its contribution process is typed code on main, and a push lands only by passing a typed gate. It is our entry to Cloudflare's "Build the next GitHub" competition, which closes Wed Oct 14, 11:59 PM PDT.

The core loop runs on Cloudflare today: a person claims an ask, pushes an answer through the platform's git gateway, and the platform checks it and lands it, or refuses it: the cheap stages answer in git's own output, and the rest arrive later in `status`, `watch`, MCP and the verdict note. The CLI, MCP and the web all serve the same contracts, and typed visibility (layers, held-back checks, posture, the ledger and write-only env values) plugs in as one cartridge. `README.md` says how to run it, check it and cut it; `docs/adr/` records each decision and why; `GLOSSARY.md` defines the words.

`bun run verify` is the gate. The principles table names the check that holds each rule; a rule marked "No fence" is held by review.

## Principles

A check wins over prose: if this file and a check disagree, fix this file.

| # | Principle | Held by |
| --- | --- | --- |
| 1 | **Encode lessons in structure; prose is the last rung.** When a mistake repeats, make it unrepresentable, then a lint or a test. | No fence |
| 2 | **Parse at the boundary, trust inside.** Decode every external input (HTTP, git, DO RPC, WebSocket, rule facts, env) with Effect Schema; inside, use branded types (`AskId`, `LandedSha`, `PatchId`). Decode the Worker `env` once, in one Layer. | The Effect diagnostics at error in `tsconfig.base.json`; `anti-slop/no-unknown-parameters`, `anti-slop/no-widen-then-assert` and `anti-slop/require-safety-comment-for-type-assertion`; `apps/platform/test/platform.test.ts` (a bad env fails at start, decoded once in `apps/platform/src/platform.ts`); `apps/platform/test/bindings.test.ts` (the decoded bindings, vars and secrets equal each wrangler.jsonc block's, the `AI` binding, `DRAFT_LIMIT`, `DRAFT_MODEL`, `PUBLIC_WEB_URL` and the code store's `CODE_CACHE` among them, and each port's factory takes its binding as the generated Env types it, without a cast); `packages/project/test/code-history.test.ts` (a kept code-history value is decoded with Schema when read, and one that no longer decodes is computed again); `packages/project/test/code.test.ts` (a kept commit that no longer decodes is computed again); `apps/web/test/dev-fixtures.test.ts` (the dev world's fixture record is decoded through the protocol's schemas when the world is built, so every case reads only a record that decodes) |
| 3 | **Refusals are a closed `Schema.TaggedError` union and a public contract.** Handle them with `Match.exhaustive` or `catchTags`. Each carries a `retryable` and a `next` command fixed per tag, an optional `at`, and no `message` field. A `_tag` is renamed only with an alias. `protocol/render` is the one renderer for git `remote:`, CLI and MCP text. Stage-1 refusals accumulate. | `packages/protocol/test/refusal.test.ts` and `packages/protocol/test/render.test.ts` (every tag, the code reads' and drafting's `UnknownPath`, `UnknownRevision`, `UnknownProposal`, `ProposalClosed` and `DraftInProgress` included; a limit's refusal names its kind and its wait, and a ref outside `refs/heads/` reads as one the platform writes); `packages/agent-kit/test/full-llms.test.ts` (every tag in the union has a row in `/llms-full.txt`); `packages/protocol/test/mcp.test.ts` (a refusal from tools/call keeps its tag); `anti-slop-effect/prefer-effect-match` and `anti-slop-effect/no-manual-tag-comparison`; `packages/gate/test/shape.test.ts` (one push hears every stage-1 refusal at once); `apps/platform/test/mcp.test.ts` (each refusing MCP contract comes back as its exact refusal, `draftAsk`, `showProposal` and a code read's `UnknownPath` included); `apps/platform/test/workflows/draft.test.ts` (past the draft limit, `CapReached`); `apps/cli/test/policy.test.ts`; `apps/cli/test/local/check.test.ts` (the local check gives the gateway's stage-1 refusals for the same commit); `packages/protocol/test/exit-code.test.ts` (each tag's CLI exit code is pinned, 75 exactly when it is retryable) |
| 4 | **One schema, many surfaces.** Change `packages/protocol`; every surface derives from it. Projections live only in `apps/*/src/surfaces.ts`. The CLI's command list is `commandDocs` in `@repo/agent-kit`, which the platform's skill, the CLI's MCP prompt and the web's `llms.txt` all read. | `apps/cli/test/commands-doc.test.ts` (the command list against the real CLI's commands, flags and positionals, `policy`, `ask draft` and `proposal` included); `packages/protocol/test/mcp.test.ts` (every MCP tool's schemas, with no JSON Schema leak, the policy and drafting contracts included; the five capped code reads are tools, `showCommit` and `listPaths` are not); `apps/web/test/agents.test.tsx` (every snippet, command, endpoint, limit and refusal on the For agents page is `@repo/agent-kit`'s or the union's); `packages/agent-kit/test/docs.test.ts` and `apps/web/test/docs.test.tsx` (the `/docs` pages name only the CLI's commands with flags each takes and link only to pages that exist, the reference lists every command, refusal, event, MCP tool and imported project from its source, and the web draws each page and its Markdown from that one text); `apps/web/test/llms.test.ts` (`/` and `/<project>` asked for Markdown answer with the `llms.txt` texts, and their HTML names that Markdown as an alternate); `packages/agent-kit/test/full-llms.test.ts` (one `ProjectEvent` line per tag); `apps/platform/test/home.test.ts` (the platform's `/` in Markdown is the web's `llms.txt`, one text from `@repo/agent-kit`); per-package `allowedUnstableApis` with `unstableApiUsage` at error |
| 5 | **The name lives only in `packages/brand`.** Internal packages use `@repo/*`. DO classes, Workflows, queues and databases carry job names. | `brand:check` (`scripts/brand.ts`, tested by `packages/brand/test/leaks.test.ts`) |
| 6 | **Pure core, thin hosts.** Only `@repo/artifacts` calls Artifacts. Each beta dependency sits behind one job-named port with a `/memory` adapter in the owning package. Apps import packages only. Worker code stays free of `node:child_process`, `@effect/platform-bun` and OpenTUI. `rules` and `gate` run in both Workers and Bun. `alchemy/*` stays in `infra/`. No module-level mutable state in a package's `src/`. | Scoped `allowedUnstableApis`; `packages/artifacts/test/repo-host-contract.ts` (one RepoHost contract every adapter passes); `apps/platform/test/bindings.test.ts` and `apps/platform/test/worker-init.test.ts` (the Worker starts on its real adapters, composed in `apps/platform/src/ports.ts`); `apps/platform/test/router-build.test.ts` (both handlers are built when the Worker module loads, with no binding touched, and a layer that awaits a promise while it is built is refused there); `apps/web/test/production-bundle.test.ts` (no dev-world module in the web's production build, and no chunk every page preloads holds the Markdown renderer, under a gzip ceiling); `packages/config/test/cartridge.test.ts` (the visibility cartridge is plugged in by one marked line and reached by nothing else, so removing it is a deletion); `packages/drafting/test/memory.test.ts` (the `Drafter` port's `/memory` adapter, `packages/drafting/src/drafter/memory.ts`) and `packages/drafting/test/binding.test.ts` (its Workers AI adapter over the `AI` binding); `packages/project/test/code-store.test.ts` (the `CodeStore` port's `/memory` adapter, `packages/project/src/code-store/memory.ts`, and its R2 adapter over `CODE_CACHE`, whose failures are misses, never the read's); `apps/platform/test/code-reads.test.ts` and `apps/web/test/dev-backend.test.ts` (the platform and the web's dev world answer the code reads and raw files alike, both through `@repo/project/code`); `packages/project/test/standing-posture.test.ts` (one helper, `withStandingPosture`, gives a listing each project's own posture, for the platform and the web's dev world alike, through the `StandingPostures` port whose default keeps nothing; its D1 adapter is the platform's); `apps/web/test/seeded.test.tsx` (a loader's read seeds a registry of its own page and leaves the registry every request shares as it was); `apps/web/test/shell.test.tsx` (no plain anchor between the web's pages: every link is the router's). No fence: import direction and module-level state |
| 7 | **Deny by default for visibility.** Land the answer's tree, never the composed tree. Nothing from a layer enters a public tree. Snapshot before held-back files are written. Public-serving Workers have no private-namespace binding. Public commits, trailers, notes and errors name public paths only. | `PrivatePathInPublicTree`, one rule for the gate's stage 1 and the landing guard (`packages/gate/test/shape.test.ts`, `packages/visibility/test/guards.test.ts`); `apps/platform/test/visibility/layer-gateway.test.ts` (only a layer's readers clone it, every read is logged, a fork push cannot carry its paths); `apps/sandbox/test/held-back.test.ts` (egress off and the snapshot taken before any sealed file is written; one bit per area, no output); `apps/platform/test/visibility/held-back.test.ts` (the `Held-back:` trailer, the landing guards, no stored value in a note or a kept log); `apps/platform/test/bindings.test.ts`; `apps/sandbox/test/checker.test.ts` (no snapshot once the held-back slot is reached); `apps/web/test/env.test-d.ts` (the web's Env has no private-namespace, Artifacts or `CODE_CACHE` binding) and `apps/platform/test/env.test-d.ts` (only the platform's has both); `packages/project/test/code-raw.test.ts` and `apps/platform/test/raw.test.ts` (raw bytes under `nosniff` and the sandboxing CSP, refusals included); `apps/platform/test/code-reads.test.ts` (no code read's payload names a repo); `packages/project/test/code-history.test.ts` (the code store is keyed under the project's canonical repo alone and holds no landing); `apps/platform/test/w9-contracts.test.ts` (`projectPolicy` answers without the policy's layers or asks, and `packages/config/test/cartridge.test.ts` keeps the cartridge removable); `packages/drafting/test/prompt.test.ts` (a draft's prompt never carries a layer's name, repo, reason or paths); `apps/web/test/markdown.test.tsx` (a README's script, handlers, unsafe URLs, iframes, styles and forms never reach the page); `apps/platform/test/gateway.test.ts` and `packages/gate/test/parse.test.ts` (a fork takes branches only: its notes, tags and the platform's refs are refused); `apps/platform/test/visibility/posture-listing.test.ts` and `apps/platform/test/home.test.ts` (the project list and the platform's `/` show the posture the project's ledger shows); `apps/web/test/landing.test.tsx` (the landing at `/` draws only the public project list, each project with the posture its listing gives); `apps/web/test/ledger.test.tsx` (the ledger page adds no path, check name or file name) and `apps/web/test/env.test.tsx` (the env page shows no value and no control to set or read one); `apps/platform/test/pages.test.ts` (the sign-in page, as an MCP client's consent, escapes every value a client supplies) |
| 8 | **Deterministic and idempotent.** Rule evaluation sees frozen time and randomness and only injected facts. Re-running an operation converges. Check results are keyed by (tree SHA, check version), push events deduped by (repo, sha), and land requests carry a `requestId`. | `globalDate`, `globalRandom`, `globalTimers` and `cryptoRandomUUID` at error, with their in-Effect twins; `packages/rules/test/replay.test.ts`; `packages/project/test/project-store.contract.ts`; `packages/project/test/claim.model.test.ts` and `packages/project/test/landing.model.test.ts`; `apps/platform/test/workflows/answer.test.ts`; `apps/platform/test/workflows/on-push.test.ts`; `apps/platform/test/core-loop.test.ts`; `apps/platform/test/workflows/draft.test.ts` (a replayed draft round asks the model nothing more, and each round is its own instance); `packages/project/test/code.test.ts` (code reads cached by object id, only once finished, while `main` resolves every time, and a commit's diff kept by its SHA without its landing); `packages/project/test/drafting.model.test.ts` (a settle of a stale round changes nothing); `packages/project/test/import.test.ts` (a retried import adopts the repo it made, and a retried import keeps its source); `packages/project/test/code-history.test.ts` (a why and a path's history are kept by commit, path hash and algorithm version, and the store, a step from a kept ancestor and a whole walk agree); `packages/config/test/smoke-loop.test.ts` (smoke's throwaway project is in the ledger before init makes it, and a taken name stops before anything is made); `apps/web/test/events.test.ts` (the web's fold of a project's events gives the same map when an event is heard twice or out of order, and a replay that already holds a landing stamps nothing); `packages/project/test/standing-posture.test.ts` (a kept posture is read again only for the project whose event the projection applied, or once its instant has come). No fence: one push deduped by (repo, sha) across the gateway's record and OnPush's |
| 9 | **Effect v4 only.** Read `node_modules/effect/src` as API truth. Off limits: `effect/unstable/*`, v3 `@effect/platform` and `@effect/cli`, and `effect/workflow` or `effect/cluster` on Workers. | `outdatedApi`; `no-restricted-imports` |
| 10 | **Escapes need a reason.** Every `oxlint-disable`, `@effect-diagnostics` or `@ts-expect-error` carries its reason after `--`, and is added only where no idiomatic code does the job. | `check` fails on an unused directive. No fence: the reason |
| 11 | **`bun run verify` is the authority.** Deploy only to an explicit stage, after `verify`, with smoke after. A red gate is fixed, never deployed around. | `packages/config/test/verify.test.ts` (verify's steps); `infra/deploy.ts` refuses without a known stage, runs `verify` first and `scripts/smoke.ts` after (`packages/config/test/deploy.test.ts`, `packages/config/test/smoke.test.ts`), and refuses every deploy while `infra/.recording` is there (`packages/config/test/recording.test.ts`) |
| 12 | **Lifecycles are pure transitions.** `transition(state, command, now)`. Per DO call: hydrate, transition, persist, settle. Deadlines run on DO alarms. Call them lifecycles. | `globalTimers` and `globalTimersInEffect`; `packages/project/test/claim.model.test.ts` and `packages/project/test/landing.model.test.ts` (model tests over effect/Arbitrary histories, each seen catching its planted bug); `packages/project/test/drafting.model.test.ts` (a proposal's `DraftCommand.DraftStarted` and `DraftSettled` over generated histories; a Ready round's files survive a later failed round); `apps/platform/test/project-do.test.ts`. No fence: `Effect.sleep` and `Effect.delay` in `packages/project/src` |

## Verify

`bun run verify` runs `lockfile:check`, `check`, `typecheck`, `test`, `brand:check` and `bytes:check`, and stops at the first failure. Run `bun run fix`, then `bun run verify`, before you stop. When a check fails, fix the cause. Loosening, skipping or disabling a check needs the user's sign-off.

**Safe by default:**

- new or tightened tests;
- tightening a rule;
- changing a lint rule that fights an idiom Effect's own docs use, with the reason beside it in `oxlint.config.ts` (lint fits Effect, not the other way around);
- an escape with its reason, where no idiomatic code does the job;
- docs;
- a cut that follows the README's "Keep or cut".

**Needs the user's sign-off:**

- a dependency that no `package.json` in the repo has yet;
- any version change to effect, wrangler or pi;
- loosening `oxlint.config.ts`, `tsconfig.base.json` (map, overrides, allow-lists), `bunfig.toml`, `turbo.json` or `package.json` scripts;
- renaming or removing a DO class;
- deleting any Cloudflare resource;
- any deploy during a recording.

## Commands

Run each as `bun run <name>` from the repo root; `--` passes flags to the script.

- `verify`: the gate (see Verify).
- `check`: lints and checks formatting; an unused escape directive fails it.
- `fix`: applies lint fixes and formatting.
- `typecheck`: type-checks every workspace and the root's scripts, Effect diagnostics included.
- `test`: runs every workspace's tests.
- `brand:check`: fails when the name appears outside `packages/brand` and prose.
- `bytes:check`: fails when a Worker's bundle grows past its byte budget.
- `lockfile:check`: fails when `bun.lock` is out of date with the manifests.
- `prepare`: runs on `bun install` and patches TypeScript with the Effect language service.
- `env:check`: shows the env with its values redacted.
- `ops -- <command>`: runs cf with the ops credentials (see Boundaries).
- `bootstrap -- --stage <stage>`: makes a stage's Cloudflare resources; a second run creates nothing, and `--dry-run` only prints the plan.
- `deploy -- --stage <stage>`: the one way to deploy. It runs `verify`, deploys the three Workers with Wrangler, reads the push trigger back, then runs `smoke`.
- `smoke -- --stage <stage>`: read-only probes against a live stage. `--loop` then runs the whole core loop on a throwaway project, `smoke-<run>`, through the CLI and git, and refuses `demo`.
- `seed`: puts the two example projects on a platform (`--world node` on this machine, or `--stage <stage>`); a second run changes nothing. `--only <example> --as <name>` seeds a fresh copy under another name, and refuses a taken one.
- `import-examples -- --stage <stage>`: imports the open-source repos the code browser is previewed on, one at a time, onto a stage (`demo` included, with its reason in `infra/stages.md`), each recorded in the ledger as kept; `--tags` backfills the tags Artifacts' import leaves out, `--only <name>` imports one, and `--world node` imports onto this machine.
- `swarm -- --stage <stage> --project <name>`: plans six fictional contributors, on four harnesses, against one split family on a stage, claims each one's ask, prepares a workspace with a clone of its fork outside the checkout, starts each harness headless on the brief and sends every refusal back into the same session, at most three times, then writes the run's summary; `--view herdr` runs them in herdr panes beside a counter, and `--dry-run` only prints the plan.
- `release -- --build | --upload --stage <stage> | --publish`: builds the CLI's npm package and two binaries, uploads a release to the stage's own bucket, which the platform serves, and leaves `npm publish` to a person: under an agent it prints the command instead.

## Nouns

Each code noun has one home:

- **Contract:** one Rpc in `protocol/src/contracts.ts`.
- **Projection:** `protocol/{cli,mcp}` and `apps/*/src/surfaces.ts`.
- **Port:** the owning package's `src/<port>.ts`.
- **Adapter:** `<package>/src/<port>/{memory,binding,rest,sqlite,local,isogit,worker,bun,json}.ts`.
- **Lifecycle:** `project/src/{claim,landing}.ts`.
- **Stage:** `gate/src/stages/*.ts`.
- **Cartridge:** a cut line removable by deletion.

Contributors meet four domain nouns: ask, answer, check and refusal. They are vocabulary, not the brand. `GLOSSARY.md` defines them.

## Boundaries

- **Competition rules apply to repo text.** Describe rival projects by mechanism, neutrally. All of this repo's code is public; no part of the submission lives in a private layer.
- **Git.** Commit on branches and merge locally. Pushing and adding a remote are the user's to do.
- **Env.** To see the env, run `bun run env:check` (`varlock load --agent`, values redacted). That is the only way to read it: `.env`, `.env.local` and `.env.*.local` stay closed. To add a variable, edit the `.env.schema` that owns it (`infra/` for tool credentials, an app's for its Worker) and ask the user to set the value. Product code reads a project's `.env.schema` only through `@repo/visibility`'s parser, and never resolves it.
- **Deploy and ops.** Deploy with Wrangler, through `infra/deploy.ts`. `cf` handles read-mostly API operations, run as `bun run ops -- <command>`. Find a command with `bun run ops -- cli search "…"` and `bun run ops -- schema <command>`, and try it with `--dry-run` before a real call. Leave cf's project commands (`dev`, `build`, `deploy`, `init`, `migrate`, `previews`) and the global `cf` alone. Ask the user before any cf `delete` or `revoke`, and keep `apps/platform` undeployed while a recording runs: `bun infra/recording.ts on` makes every deploy refuse until a person runs `off`. `wrangler delete` auto-confirms in a non-interactive shell, so never run it without the user's OK; cf deletes need `--force` when non-interactive. Throwaways leave through `bun infra/teardown.ts`, which prints its plan from the ledger (`infra/created.jsonl`); its `--apply` deletes, so it is the user's to run, as a cf `delete` is.
- **Ported code is ours.** A ported file carries its upstream licence notice in its header; a vendored folder or a font keeps its licence file beside it. Change ported files freely; upstream `main` is never synced in. Borrowed code stays under 15% of the codebase (aim for about 5%).

## Effect traps

- Wire schemas in `protocol` use `Schema.Int` or `Schema.Finite` in place of bare `Schema.Number`, and `Schema.optionalKey` in place of `Schema.optional`. The bare forms put `"Infinity"` strings and `null` into JSON Schema and MCP tool schemas, which `packages/protocol/test/mcp.test.ts` refuses.
- The Effect language service reads an `@effect-diagnostics` directive anywhere in the source, string literals included, and a directive there fails `typecheck` (TS377000, "has no effect"). A test that needs the directive as data joins the string at run time.
- Promises and web streams enter Effect through `Effect.tryPromise` and `Stream.fromReadableStream`/`toReadableStream`; the `asyncFunction` diagnostic bans `async`.
- Tests that spawn processes or open sockets use `it.live`; `it.effect` runs on the TestClock.
- `McpServer.layerStdio` interrupts the fiber that started it when stdin ends; in tests, fork the server and await it.
- The RPC HTTP client carries Rpc headers inside the body, so send a credential as a plain HTTP header.

## Rejected dependencies

Each was weighed and turned down; re-adding one needs sign-off.

- `agents`: McpAgent is deprecated, it brings 17 peer dependencies, and it pins the MCP SDK at 2.0.0.
- `alchemy`, until after Oct 14: released Alchemy can't declare DO-managed containers (PR #1905), so it would be a two-tool hybrid, with beta churn.
- cf's project commands, `cloudflare.config.ts` and `@cloudflare/config`: the config can't declare `triggers.events`, the deploy refuses the sandbox's container self-binding, and it would be a second deploy tool in recording week.
- `@cloudflare/vite-plugin@beta`: a sha-tagged beta. Web stays on the stable plugin.
- `@cloudflare/containers`: the pre-1.0 model.
- `vite-plus`: after the deadline.
- v3 `@effect/platform` and `@effect/cli`; `effect/workflow`; `effect/cluster`.
- `@effect/language-service` as a package: on TypeScript 7, `@effect/tsgo` serves the plugin.
- nx, moon, biome, ink, commander, citty, @clack/prompts, rwsdk, react-router, foldkit, Terraform, Pulumi, SST, node-diff3, pnpm.
- varlock's runtime (`@varlock/cloudflare-integration/init`, `varlock/env`, `varlock/auto-load`) in any Worker: it wraps the global `Response`, and the gateway streams git packs. `varlockCloudflareVitePlugin()` in `apps/web`: web has no secrets.
- `@cloudflare/forge`, its SDK transformer, `fern-api` and cf's generator: they aren't on npm, Fern rejects our `_tag` unions, and the output carries Cloudflare branding. No HttpApi, OpenAPI or `openapi.json` surface in the window, and no "generated by Forge" claim.
- From Rat Stack: `packages/capability` as the schema source (fallback only), `toHttpApi`, code mode, the subprocess sandbox, devtools, the 1,534-line oxlint boundaries plugin, and any fork or template of the repo.
- XState in the window; the `no-comments` rule; Alchemy PR preview packages; `herdr-ts-sdk`.
- shadcn's `command` (it brings `cmdk`, built on Radix), `sidebar` (its source calls `Math.random()`, which typecheck refuses, and its `use-mobile` hook fails lint) and `resizable` (it adds `react-resizable-panels`, and a fixed grid does the job) in `apps/web`.
- DOMPurify for a README's HTML: it needs a DOM, which the Worker has not got. `rehype-sanitize` runs the same on the server and in the browser.
- Any inbound or two-way GitHub sync. It would be a second way onto `main` that skips the gate.
- A decentralised-identity client (an atproto OAuth client, a DID resolver) behind the handle: a sign-in redesign and a third party's account as identity (ADR 0016). A second identity, if ever, is a key the person holds.

## Agent skills

### Issue tracker

Issues are local markdown files in `.scratch/`, each written as an ask from `.scratch/TEMPLATE.md`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
