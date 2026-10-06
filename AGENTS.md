# Myr

Myr is a whole Git platform on Cloudflare. Everything a project ships is public, the contribution process is typed code, and a push lands only by passing a typed gate. It is our entry to Cloudflare's "Build the next GitHub" competition, which closes Wed Oct 14, 11:59 PM PDT.

**Day 0.** Every script, package and check named below is planned, not built. Until a rule's fence exists, review holds it: build the fence, then rely on it.

The plan is the synthesis: `~/Developer/projects/wanted-explainer/notes/git-platform-research/zoom-out/synthesis.md`, published at https://plans.gneiss.run/wanted-explainer/zoom-out/synthesis.html. Read the section your task touches:

- the concept: §3;
- the repo tree and stack: §4, with the final tree in §13.3;
- dependency versions: §4.4;
- the day plan and cut lines: §7.2;
- the GLOSSARY.md and ADR drafts: §8.

## Principles

Fence wins over prose: if this file and an enforced check disagree, the check wins; fix this file. A rule held by "No fence yet" is debt: give it a fence.

| # | Principle | Held by |
|---|---|---|
| 1 | **Encode lessons in structure; prose is the last rung.** When a mistake repeats, make it unrepresentable, then a lint or test, then a skill. | `packages/config/test/agents-table.test.ts`: every enforcer named here exists |
| 2 | **Parse at the boundary, trust inside.** Decode every external input (HTTP, git, DO RPC, WebSocket, rule facts, env) with Effect Schema; inside, use branded types (`AskId`, `LandedSha`, `PatchId`). Decode the Worker `env` once, in one Layer. | Effect diagnostics map at `error`; anti-slop Effect rules; `env` typed by the generated `worker-configuration.d.ts`, with no `as` on `env` |
| 3 | **Refusals are a closed `Schema.TaggedError` union and a public contract.** Handle them with `Match.exhaustive` or `catchTags`. Each carries a static `retryable`, a `next` command and an optional `at`, and no `message` field. A `_tag` is renamed only with an alias. `protocol/render` is the one renderer for git `remote:`, CLI and MCP text. Stage-1 refusals accumulate. | Union test; `gen:check` on `docs/reference/refusals.md`; an MCP `tools/call` test |
| 4 | **One schema, many surfaces.** Change `packages/protocol`, then run `bun run gen`. `skills/`, `plugins/` and `docs/reference/` are generated. Projections live only in `apps/*/src/surfaces.ts`. | `gen:check` (`git diff --exit-code` after gen); per-package `allowedUnstableApis` |
| 5 | **The name lives only in `packages/brand`.** Internal packages use `@repo/*`. DO classes, Workflows, queues and databases carry job names. | `brand:check` in `verify`; `scripts/acceptance.ts` renames the brand at random |
| 6 | **Pure core, thin hosts.** Only `@repo/artifacts` calls Artifacts. Each beta dependency sits behind one job-named port with a `/memory` adapter in the owning package. Apps import packages only. Worker code stays free of `node:child_process`, `@effect/platform-bun` and OpenTUI. `rules` and `gate` run in both Workers and Bun. `alchemy/*` stays in `infra/`. | dependency-cruiser in `packages/config`; scoped `allowedUnstableApis`; `no-module-level-mutable-state` |
| 7 | **Deny by default for visibility.** Land the answer's tree, never the composed tree. Nothing from a layer enters a public tree. Snapshot before held-back files are written. Public-serving Workers have no private-namespace binding. Public commits, trailers, notes and errors name public paths only. | `PrivatePathInPublicTree` and snapshot-order tests; a type test that `apps/web/worker-configuration.d.ts` has no `ARTIFACTS_PRIVATE` |
| 8 | **Deterministic and idempotent.** Rule evaluation sees frozen time and randomness and only injected facts. Re-running an operation converges. Check results are keyed by (tree SHA, check version), push events deduped by (repo, sha), and land requests carry a `requestId`. | `globalDate`, `globalRandom`, `globalTimers` and `cryptoRandomUUID` at `error`; replay-twice and dedupe tests; lifecycle model tests |
| 9 | **Effect v4 only.** Read `node_modules/effect/src` as API truth. Off limits: `effect/unstable/*`, v3 `@effect/platform` and `@effect/cli`, and `effect/workflow` or `effect/cluster` on Workers. | `outdatedApi`; oxlint `no-restricted-imports`; `no-manual-effect-runtime-in-tests` |
| 10 | **Escapes need a reason and only shrink.** Every `oxlint-disable`, `@effect-diagnostics` or `@ts-expect-error` carries a reason after ` -- ` and is counted. The count rises only with sign-off. | `scripts/debt.ts` against `debt.baseline.json` in `verify`; unused directives at `error` |
| 11 | **Hooks are early feedback; `bun run verify` and CI are the authority.** Deploy only to an explicit stage, after `verify`, with smoke after. A red gate is fixed, never deployed around. | lefthook, plus `scripts/hooks/vcs-policy.ts` and its bypass-variant tests; `infra/deploy.ts` refuses without a stage and runs `scripts/smoke.ts`. No fence yet: CI on a cold install |
| 12 | **Lifecycles are pure transitions.** `transition(state, command, now)`. Per DO call: hydrate, transition, persist, settle. Deadlines run on DO alarms. Call them lifecycles. | Model tests over `effect/Arbitrary` histories with one planted bug. No fence yet: a lint banning `Effect.sleep` and `setTimeout` in `packages/project` |

## Fence

`bun run verify` is the gate: check, typecheck, test, `gen:check`, `brand:check` and deps. Run it before you stop. When a hook or check fails, fix the cause. Loosening, skipping or disabling a check needs the user's sign-off.

**Safe by default:**
- new or tightened tests;
- tightening a rule;
- a reasoned escape that keeps the count at or below the baseline;
- docs;
- a cut that follows the README's "Keep or cut".

**Needs the user's sign-off:**
- a dependency outside the synthesis §4.4 adopt list;
- any version change to effect, wrangler or pi;
- loosening `oxlint.config.ts`, `tsconfig.base.json` (map, overrides, allow-lists), `.dependency-cruiser.cjs`, `lefthook.yml`, `scripts/hooks/*`, `turbo.json` or `package.json` scripts;
- raising `debt.baseline.json`;
- renaming or removing a DO class;
- deleting any Cloudflare resource;
- any deploy during a recording;
- removing a credit from `PROVENANCE.md`.

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
- **Env.** To see the env, run `bun run env:check` (`varlock load --agent`, values redacted). That is the only way to read it: `.env`, `.env.local` and `.env.*.local` stay closed. To add a variable, edit the app's `.env.schema` and ask the user to set the value. Product code reads a project's `.env.schema` only through `@repo/visibility`'s parser, and never resolves it.
- **Deploy and ops.** Deploy with Wrangler, through `infra/deploy.ts`. `cf` handles read-mostly API operations, run as `bun run ops -- <command>`. Find a command with `bun run ops -- cli search "…"` and `bun run ops -- schema <command>`, and try it with `--dry-run` before a real call. Leave cf's project commands (`dev`, `build`, `deploy`, `init`, `migrate`, `previews`) and the global `cf` alone. Ask the user before any cf `delete` or `revoke`, and keep `apps/platform` undeployed while a recording runs.
- **Ported code is ours.** Change ported files freely and record each change in `PROVENANCE.md`. Upstream `main` is never synced in. Borrowed code stays under 15% of the codebase (aim for about 5%).

## Effect traps

Wire schemas in `protocol` use `Schema.Int` or `Schema.Finite` in place of bare `Schema.Number`, and `Schema.optionalKey` in place of `Schema.optional`. The bare forms put `"Infinity"` strings and `null` into JSON Schema and MCP tool schemas.

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
- Any inbound or two-way GitHub sync. It would be a second way onto `main` that skips the gate.

## Agent skills

### Issue tracker

Issues are local markdown files in `.scratch/`, each written as an ask from `.scratch/TEMPLATE.md`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
