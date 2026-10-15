---
name: oscar__myr-contribute
description: "Answer one of oscar/myr's asks on Myr: claim it, change only its territory, run `myr check`, push it to your fork, and read the verdict. Use when working on oscar/myr, or when a push to it was refused."
metadata:
  managed-by: "myr"
  landed: "217fe3dad53fce835221bb8b5aa9bc417df43fdc"
  content-hash: "sha256:eaff8a734bae8fa32d10127e03b1c4e15a68997d622ad60e8b6338ac622ea30b"
---
# Contribute to oscar/myr

How to answer oscar/myr's asks on Myr. It is generated from oscar/myr's config folder: the gate decides what lands, and where this text and the gate differ, the gate wins. Don't edit it by hand; it is regenerated when the config changes.

## The loop

1. Read the ask, then claim it: `myr ask <ask>`, then `myr claim <ask>`. The claim prints your fork's remote; add it with `git remote add myr <remote>`.
2. Work inside the ask's territory until its check passes.
3. Run `myr check`. It gives the refusals a push would get, then runs the ask's check and the project's lanes; fix everything it reports.
4. Push your answer to your fork: `git push myr HEAD:main`. The push itself can be refused, on git's `remote:` lines.
5. Wait for the verdict: the rest of the checks run on the platform after git returns. Run `myr status --json` until your answer's `outcome._tag` is no longer `Checking`, then read the verdict on your head: `git fetch myr refs/notes/myr:refs/notes/myr`, then `git notes --ref=myr show HEAD`. It is JSON: match on its `_tag`, and run a refusal's `next`.

A claim stays alive only while you push to it: after 2 hours without a push it is warned, and after 1 day it lapses. You may hold 20 claims at once in this project.

List the open asks with `myr asks`. Add `--json` to any command for one JSON envelope instead of Markdown.

## What an answer may change

Change files only inside the ask's territory, the module `myr ask <ask>` names; a push that changes anything else is refused with `OutOfScope`.

| Module | Paths | Public files |
| --- | --- | --- |
| `@repo/agent-kit` | `packages/agent-kit/**` | `packages/agent-kit/src/index.ts`, `packages/agent-kit/src/*.ts` |
| `@repo/artifacts` | `packages/artifacts/**` | `packages/artifacts/src/fetch.ts`, `packages/artifacts/src/repo-host.ts`, `packages/artifacts/src/repo-host/memory.ts`, `packages/artifacts/src/repo-host/memory-fs.ts`, `packages/artifacts/src/repo-host/binding.ts`, `packages/artifacts/src/repo-host/rest.ts`, `packages/artifacts/src/repo-host/local.ts`, `packages/artifacts/src/repo-host/smart-http.ts`, `packages/artifacts/src/*.ts` |
| `@repo/brand` | `packages/brand/**` | `packages/brand/src/index.ts`, `packages/brand/src/leaks.ts` |
| `@repo/checks` | `packages/checks/**` | `packages/checks/src/kinds.ts`, `packages/checks/src/finder.ts`, `packages/checks/src/judge.ts`, `packages/checks/src/classify.ts`, `packages/checks/src/red-first.ts`, `packages/checks/src/weak-shapes.ts`, `packages/checks/src/phases.ts`, `packages/checks/src/check-runner.ts`, `packages/checks/src/check-runner/memory.ts`, `packages/checks/src/check-runner/local.ts`, `packages/checks/src/null-answer.ts`, `packages/checks/src/*.ts` |
| `@repo/cli` | `apps/cli/**` | every file |
| `@repo/config` | `packages/config/**` | `packages/config/src/vitest.ts` |
| `@repo/gate` | `packages/gate/**` | `packages/gate/src/facts.ts`, `packages/gate/src/stage.ts`, `packages/gate/src/stages/*.ts`, `packages/gate/src/classify.ts`, `packages/gate/src/verdict.ts`, `packages/gate/src/markers.ts`, `packages/gate/src/gate.ts`, `packages/gate/src/*.ts` |
| `@repo/git` | `packages/git/**` | `packages/git/src/custody.ts`, `packages/git/src/gateway.ts`, `packages/git/src/upstream.ts`, `packages/git/src/upstream/repo-host.ts`, `packages/git/src/trailers.ts`, `packages/git/src/tree-diff.ts`, `packages/git/src/patch-id.ts`, `packages/git/src/notes.ts`, `packages/git/src/*.ts` |
| `@repo/platform` | `apps/platform/**` | every file |
| `@repo/project` | `packages/project/**` | `packages/project/src/claim.ts`, `packages/project/src/landing.ts`, `packages/project/src/listing.ts`, `packages/project/src/project-store.ts`, `packages/project/src/project-store/rows.ts`, `packages/project/src/project-store/memory.ts`, `packages/project/src/project-store/sqlite.ts`, `packages/project/src/lander.ts`, `packages/project/src/lander/memory.ts`, `packages/project/src/lander/isogit.ts`, `packages/project/src/projects.ts`, `packages/project/src/projects/memory.ts`, `packages/project/src/project.ts`, `packages/project/src/alarms.ts`, `packages/project/src/alarms/memory.ts`, `packages/project/src/answer-runs.ts`, `packages/project/src/background.ts`, `packages/project/src/answer-runs/inline.ts`, `packages/project/src/projection.ts`, `packages/project/src/projection/memory.ts`, `packages/project/src/front-page.ts`, `packages/project/src/front-page/memory.ts`, `packages/project/src/projection-d1/*.ts`, `packages/project/src/lander/wire.ts`, `packages/project/src/attention/*.ts`, `packages/project/src/*.ts` |
| `@repo/protocol` | `packages/protocol/**` | `packages/protocol/src/audit.ts`, `packages/protocol/src/cli.ts`, `packages/protocol/src/contracts.ts`, `packages/protocol/src/domain/*.ts`, `packages/protocol/src/envelope.ts`, `packages/protocol/src/ids.ts`, `packages/protocol/src/mcp.ts`, `packages/protocol/src/mcp-extras.ts`, `packages/protocol/src/posture.ts`, `packages/protocol/src/principal.ts`, `packages/protocol/src/refusal.ts`, `packages/protocol/src/render.ts`, `packages/protocol/src/testing.ts`, `packages/protocol/src/*.ts` |
| `@repo/rules` | `packages/rules/**` | `packages/rules/src/rules-evaluator.ts`, `packages/rules/src/rules-evaluator/bun.ts`, `packages/rules/src/rules-evaluator/json.ts`, `packages/rules/src/rules-evaluator/worker.ts`, `packages/rules/src/defaults.ts`, `packages/rules/src/finish.ts`, `packages/rules/src/vouch.ts`, `packages/rules/src/*.ts` |
| `@repo/sandbox` | `apps/sandbox/**` | every file |
| `@repo/sdk` | `packages/sdk/**` | `packages/sdk/src/index.ts`, `packages/sdk/src/*.ts` |
| `@repo/telemetry` | `packages/telemetry/**` | `packages/telemetry/src/*.ts` |
| `@repo/testkit` | `packages/testkit/**` | `packages/testkit/src/git.ts`, `packages/testkit/src/http-backend.ts`, `packages/testkit/src/git-client.ts`, `packages/testkit/src/scenarios.ts`, `packages/testkit/src/golden.ts`, `packages/testkit/src/clock.ts`, `packages/testkit/src/fake-artifacts-binding.ts`, `packages/testkit/src/*.ts` |
| `@repo/visibility` | `packages/visibility/**` | `packages/visibility/src/index.ts`, `packages/visibility/src/*.ts` |
| `@repo/web` | `apps/web/**` | every file |

Import another module only through its public files; an import that reaches past them is refused with `ReachedInternals`.

Never change the judge closure, the files that decide what the checks do; a push that changes one is refused with `TouchedJudge`:

- `.myr/**`
- `**/.env.schema`
- `**/.env.*`
- `!**/.env.local`
- `!**/.env.*.local`
- `.github/workflows/**`
- `.github/actions/**`
- `.forgejo/**`
- `**/vitest.config.*`
- `**/vitest.*.config.*`
- `**/vitest.workspace.*`
- `**/vite.config.*`
- `**/oxlint.config.*`
- `**/oxlint.*.config.*`
- `**/.oxlintrc*`
- `**/eslint.config.*`
- `**/eslint.*.config.*`
- `**/.eslintrc*`
- `**/tsconfig*.json`
- `tools/oxlint/**`
- `.agents/skills/*-contribute/**`
- `.claude/skills/*-contribute/**`
- `**/bunfig.toml`
- `pnpm-workspace.yaml`
- `**/turbo.json`
- `**/turbo.jsonc`
- `nx.json`
- `.yarnrc.yml`
- `.yarn/plugins/**`
- `.yarn/releases/**`
- `**/oxfmt.config.*`
- `**/.oxfmtrc*`
- `**/biome.json*`
- `**/.prettierrc*`
- `**/prettier.config.*`
- `.claude/settings*.json`
- `.cursor/hooks.json`
- `.codex/hooks.json`
- `.codex/config.toml`
- `.github/hooks/*.json`
- `.github/copilot/settings.json`
- `.gemini/settings.json`
- `.pi/**`
- `.opencode/plugins/**`
- `.amp/plugins/**`
- `lefthook.yml`
- `lefthook.yaml`
- `.lefthook.yml`
- `.lefthook.yaml`
- `.lefthook/**`
- `.husky/**`
- `.pre-commit-config.yaml`
- `**/*-rule.spec.*`
- `**/*-rule.test.*`
- `examples/burrow/tools/oxlint/__fixtures__/**`
- `examples/burrow/tools/oxlint/burrow/**`
- `examples/burrow/tools/oxlint/test/**`
- `examples/burrow/tools/oxlint/tests/**`
- `packages/__fixtures__/**`
- `packages/brand/**`
- `packages/checks/test/judge.test.ts`
- `packages/config/test/example-datekit.test.ts`
- `packages/config/test/release.test.ts`
- `packages/config/test/seed-layer.test.ts`
- `packages/config/test/seed.test.ts`
- `packages/config/test/smoke-loop.test.ts`
- `packages/config/test/swarm-herdr.test.ts`
- `packages/config/test/swarm-loop.test.ts`
- `packages/config/test/swarm.test.ts`
- `packages/test/**`
- `packages/tests/**`
- `tools/oxlint/__fixtures__/**`
- `tools/oxlint/anti-slop/**`
- `tools/oxlint/test/**`
- `tools/oxlint/tests/**`
- `tsconfig.base.json`
- `package.json#/scripts` (only that part of the file)
- `apps/cli/package.json#/scripts` (only that part of the file)
- `apps/platform/package.json#/scripts` (only that part of the file)
- `apps/sandbox/package.json#/scripts` (only that part of the file)
- `apps/web/package.json#/scripts` (only that part of the file)
- `examples/burrow/.myr/package.json#/scripts` (only that part of the file)
- `examples/burrow/package.json#/scripts` (only that part of the file)
- `examples/burrow/packages/auth/package.json#/scripts` (only that part of the file)
- `examples/burrow/packages/billing/package.json#/scripts` (only that part of the file)
- `examples/burrow/packages/catalog/package.json#/scripts` (only that part of the file)
- `examples/burrow/packages/kit/package.json#/scripts` (only that part of the file)
- `examples/burrow/packages/notify/package.json#/scripts` (only that part of the file)
- `examples/burrow/packages/search/package.json#/scripts` (only that part of the file)
- `examples/datekit/.myr/package.json#/scripts` (only that part of the file)
- `examples/datekit/package.json#/scripts` (only that part of the file)
- `packages/agent-kit/package.json#/scripts` (only that part of the file)
- `packages/artifacts/package.json#/scripts` (only that part of the file)
- `packages/brand/package.json#/scripts` (only that part of the file)
- `packages/checks/package.json#/scripts` (only that part of the file)
- `packages/config/package.json#/scripts` (only that part of the file)
- `packages/gate/package.json#/scripts` (only that part of the file)
- `packages/git/package.json#/scripts` (only that part of the file)
- `packages/project/package.json#/scripts` (only that part of the file)
- `packages/protocol/package.json#/scripts` (only that part of the file)
- `packages/rules/package.json#/scripts` (only that part of the file)
- `packages/sdk/package.json#/scripts` (only that part of the file)
- `packages/telemetry/package.json#/scripts` (only that part of the file)
- `packages/testkit/package.json#/scripts` (only that part of the file)
- `packages/visibility/package.json#/scripts` (only that part of the file)

## The run block

The project's own commands. The platform runs them exactly as written, on the merged tree, in the `checker:default` image; `myr check` runs them on your machine.

- Setup, once: `bun install --frozen-lockfile`
- One check file: `bun run test`, with `{path}` the ask's check file
- Lanes, each run on every answer:
  - `lint`: `bun run check`
  - `types`: `bun run typecheck`
  - `unit`: `bun run test`

## Ask kinds

Each ask is of one kind, which says how its check judges an answer, who may claim it and whether a maintainer finishes it; `myr ask <ask>` names it.

### `fix`

- Check: one check file fails on main by an assertion, and passes with your answer; `myr check` runs it with `bun run test`.
- Who may claim: anyone a member has vouched for in `.myr/vouched.td`.
- Claims at once: 1; the claim is exclusive.
- Finish: a maintainer may add commits of their own to a passing answer before it lands, credited `Finished-by`.
- The brief states: want, check and territory.

## Refusals

Instead of landing an answer, the platform answers with refusals. Git prints them on its `remote:` lines, `myr check` and `myr status` print them, and the verdict note holds them as JSON. Each one has a `_tag`, `retryable` (whether trying the same thing again can help) and `next` (the command to run next). The refusals about an answer's files arrive together, so one push hears about all of them. The CLI exits with a refusal's code: 75 when trying again can help, and 65, 66 or 77 when something has to change first.

| `_tag` | Retryable | Exit code | `next` | What to do |
| --- | --- | --- | --- | --- |
| `NotClaimed` | yes | 75 | `myr claim <ask>` | Claim the ask, then push again. |
| `ClaimLapsed` | yes | 75 | `myr claim <ask>` | Your claim lapsed after a spell without a push: claim the ask again if it is still open. |
| `NotVouched` | no | 77 | `myr policy --project <owner>/<name>` | Ask a member of the project to vouch for you. |
| `CapReached` | yes | 75 | `myr status` | Read `limit`: for claims, release or land a claim you hold; for discussions, wait for one of yours to close; with `retryAfter`, wait that many seconds and try again. |
| `AskFull` | yes | 75 | `myr asks` | Someone else holds the claim: pick another ask. |
| `NoAsk` | no | 66 | `myr asks` | Push to the fork your claim gave you, which names its ask. |
| `RepoBusy` | yes | 75 | `git push` | Push again. |
| `DirectPush` | no | 77 | `myr fork --project <owner>/<name>` | Main moves only by a landing. A contributor pushes the answer to the claim's fork; a maintainer makes a working fork with `next` and lands it with `land`. |
| `AskBlocked` | yes | 75 | `myr asks` | Wait for the asks it names to land, or answer one of them first. |
| `Denounced` | no | 77 | `myr policy --project <owner>/<name>` | The project's vouch file denounces you: it takes no claims or posts from you. |
| `OutOfScope` | no | 65 | `myr check` | Undo your changes to the paths it names: they are outside the ask's territory. |
| `TouchedJudge` | no | 65 | `myr check` | Undo your changes to the paths it names: they decide what the checks do. |
| `Weakened` | no | 65 | `myr check` | Take the marker out; a marker without a reason may get one after ` -- ` for a maintainer to weigh, but one a maintainer declined stays out; never raise a ratchet. |
| `PrivatePathInPublicTree` | no | 65 | `myr check` | Take the held-back paths it names out of your answer. |
| `ReachedInternals` | no | 65 | `myr check` | Import the other module only through its public files. |
| `StaleBase` | yes | 75 | `git push myr HEAD:main` | Main moved under the answer. With no `conflicts`, push again: the platform merges onto the moved main itself. With `conflicts`, merge the project's main into your answer, resolve, and push again. `movedBy` names the landing that last changed each conflicting path, with its `author` and `ask`: keep that change as you resolve. |
| `StaleLayer` | yes | 75 | `myr status` | Nothing: the answer is checked again. |
| `ChecksFailed` | no | 65 | the command that reproduces the failure | Run `next` to see the failure, fix it, and push again. |
| `HeldBackFailed` | no | 65 | `myr verdict <ask> --project <owner>/<name>` | A held-back check failed; you see only its area and suite. Fix the behaviour and push again. |
| `AttemptsExhausted` | yes | 75 | `myr status` | Wait until `resetsAt`: you used every attempt on that area's held-back checks for now. |
| `Flake` | yes | 75 | `myr status` | Nothing: the check failed and then passed on the same tree, and the platform runs it again. |
| `VerifierBlocked` | yes | 75 | `myr status` | Nothing: the platform could not run the checks, and runs them again. |

## No fence yet

Norms that nothing checks yet. Keep them; the gate does not refuse an answer that breaks one.

- Keep an answer to its ask's want. The gate holds the files you change to the territory, but nothing measures how much you change inside it.
- Name the agent you work through. A landing carries an `Assisted-by:` trailer for the agent your harness's environment names; a harness that names none goes unnamed.
