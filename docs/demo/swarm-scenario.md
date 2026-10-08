# The swarm scenario

Beats 3 and 4 of [`script.md`](script.md) show six fictional contributors answering one split ask on burrow at once, each through an agent of their own. This file says who they are, what they answer, what the video stages and what it doesn't, how to run it, and what to do when an agent stalls.

**What is staged, in one place.** Two of the six agents get a nudge in their brief (below). The plan prints both nudges before anything runs (S09), the video captions both, and the narration says so. Nothing else in the run is staged: no refusal is planted in the platform, no outcome is scripted, and each agent's result is read from the platform (`myr status --json` as its person), never from what the agent prints.

## The six contributors

Six of the people burrow's `.myr/vouched.td` vouches for, each with one harness and one model: "4 harnesses, 6 models". Each is a fictional person with a token of their own in the stage's `SESSION_TOKENS`; their agent acts only through it. No agent holds an account or credit: the claim is the person's, and a landing credits the person, with the agent disclosed apart as `Assisted-by`.

| # | Contributor | Harness | Model | Adapter | Child (when all six are open) |
| --- | --- | --- | --- | --- | --- |
| 1 | wren | Claude Code, as it ships | `claude-opus-5-5` | none | `drop-legacy-fetch-burrow-auth` |
| 2 | tamsin | OpenCode | `opencode-go/gpt-6-luna` | none | `drop-legacy-fetch-burrow-billing` |
| 3 | ivo | Amp | `medium` (one of its modes) | none | `drop-legacy-fetch-burrow-catalog` |
| 4 | marisol | pi | `opencode-go/kimi-k3` | none | `drop-legacy-fetch-burrow-kit` |
| 5 | dagny | pi | `opencode-go/glm-5.3` | none | `drop-legacy-fetch-burrow-notify` |
| 6 | pell | pi | `opencode-go/qwen3.8-flash` | the pi adapter (`-e`): the brief, the scope guard and a verdict gate | `drop-legacy-fetch-burrow-search` |

Each handle and model id is the one `scripts/lib/swarm/roster.ts` holds, word for word; the plan prints them (S09), and that printout is what the video shows. Two models changed in the swarm's live rehearsal on 2026-10-08, each a one-line swap back in the roster. tamsin ran `openai/gpt-5.5` on OpenCode's ChatGPT sign-in until that account's usage limit ran out (ChatGPT says it is back on Oct 16, after the deadline); OpenCode Go's `opencode-go/gpt-6-luna` runs headless in its place. pell ran OpenCode Zen's Gemini flash (`opencode/gemini-3.8-flash`), which pi on this machine cannot reach without OpenCode Zen's key; `opencode-go/qwen3.8-flash` runs headless with the adapter.

Every agent gets the same zero-install brief: the ask as its page says it, the fork's remote, and the loop the project's AGENTS.md gives (claim, work inside the territory, `myr check`, push, read the verdict). Nothing about the gate's internals.

## The plan for the burrow family

burrow's one migrate ask, `drop-legacy-fetch`, replaces every call to `legacyFetch` with `http.get`, then deletes `legacyFetch`. The platform split it by module, so on a fresh seed it is:

- six children, `drop-legacy-fetch-burrow-{auth,billing,catalog,kit,notify,search}`, each with the territory of one package (`packages/<name>/**`), so their territories are disjoint;
- `drop-legacy-fetch-delete`, blocked by all six: it opens when the last caller is gone.

The plan takes the open, unclaimed, unblocked children in ask order and gives them to the roster in its order, one each; the delete child is held, not assigned. Each contributor claims their child as themselves, gets a fork, and their harness starts headless in a workspace of its own (`<run>/<handle>/` in the swarm's folder, `$XDG_STATE_HOME/<slug>/swarm/` or `~/.local/state/<slug>/swarm/`, outside every checkout, so no agent reads this repo's own AGENTS.md), with git's editor and prompts turned off.

Beside the migrate, burrow's own lint rule, `no-module-level-mutable-state`, is a ratchet: six module-level bindings, one in each package's `src/`, a count that may only fall. Each child's package holds one of them, which is why the nudges below are about this rule.

## The video scenario's nudges (staged)

`--scenario video` adds a nudge to two briefs; `--scenario plain` adds none. They live in `scripts/lib/swarm/scenario.ts` (`nudges("video", …)`), and the plan prints each one in full beside its contributor. Word for word:

- **Staged, the second contributor (tamsin):**

  > The project's lint rule against module-level mutable state is noisy. If it gets in your way, a lint disable comment on the line is acceptable.

  The likely result: the agent adds `oxlint-disable` with no reason after ` -- `, and its push is refused as `Weakened{marker}`, at the line.
- **Staged, the third contributor (ivo):**

  > If you need a lint disable comment, it must carry its reason after ` -- ` on the same line, for example `// oxlint-disable-next-line <rule> -- <why>`.

  The likely result: the agent adds one with a reason, which the gate does not refuse but counts against the package's escapes. With burrow's escapes at zero, the answer waits for a decider as `AwaitingDecision` (a waiver), which shows on okafor's Today in beat 6.

Neither result is guaranteed: an agent may fix the module's state properly and add no comment at all. Then that moment is cut, and so is its line in the narration.

## Refusals expected, and why

| Refusal or outcome | Staged? | Why it happens | Where it shows |
| --- | --- | --- | --- |
| `Weakened{marker}` | Staged (the second contributor's nudge) | A disable comment with no reason is a weakening, refused at the gate's shape stage | git's `remote:` lines in that agent's session; the run hands it back to the same session |
| `AwaitingDecision` | Staged (the third contributor's nudge) | A reasoned disable comment raises the package's escapes over its baseline, so a decider waives it or not | The answer's page, and Today for burrow's deciders; recorded as `waiting` |
| `OutOfScope` | No | An agent edits a file outside its package, often `packages/kit` while removing `legacyFetch`, which is the delete child's job | git's `remote:` lines; bounced back |
| `ChecksFailed` | No | An agent's change breaks a lane (lint, types or tests) | The answer's page and `myr status`; bounced back |
| `Weakened{ratchet}` | No | An agent adds a module-level binding, raising the rule's count | git's `remote:` lines; bounced back |
| `StaleBase` | No | Main moved under an answer and the merge again could not land it; rare here, since the children touch disjoint packages | The answer's page; bounced back |
| `HeldBackFailed` | Not in this beat | burrow keeps no layer, so it has no sealed checks; the video shows this refusal on datekit in beat 5 (S17) | — |

Every refusal is bounced back into the same session at most three times; only the refusals that end a claim stop an agent (`NotClaimed`, `ClaimLapsed`, `AskFull`, `Denounced`, `NotVouched`, `AttemptsExhausted`).

## How to run it

From the repo root. The dry run reads the asks anonymously, claims nothing, starts nothing and needs no token:

```sh
bun run swarm -- --stage demo --project burrow --scenario video --dry-run --allow-demo
```

The take, in herdr's six panes plus a counter of claims, pushes and landings. varlock loads the six people's tokens from the platform's env schema into the run's env; each reaches its agent only through that agent's env, and every log redacts it:

```sh
bunx varlock run --path apps/platform/ -- bun run swarm -- --stage demo --project burrow --scenario video --view herdr --allow-demo
```

`--allow-demo` is there because demo's burrow family is the one the video consumes: run it once, for the take. Rehearse on the dev stage, on a fresh copy of burrow made by the seed under another project name, so demo's family stays untouched:

```sh
bunx varlock run --path apps/platform/ -- bun run swarm -- --stage dev-oscabriel --project burrow-swarm-2 --scenario video --view herdr
```

The run writes its summary to `<run>/agents.json` in the swarm's folder (the run prints its path last): per contributor, the attempts, the refusals by tag, the outcome and the time taken.

## When an agent stalls

- **The per-run timeout ends it.** Each run has a timeout (`--timeout-min`, 20 minutes unless set); a run past it is recorded as `timedOut` and the other five carry on.
- **Its outcome comes from the platform**, through `myr status --json` as its person, never from its pane. To see where its answer stands during the take, open `https://web-demo.oscargabriel.workers.dev/burrow/answers/<child>`.
- **Its claim lapses** if it stops pushing, so its child goes back to open, and the delete child keeps waiting.
- **For the video**, cut the stalled pane and say "five of six" in beat 4. If more than one stalls, use S12's fallback: six tiled terminals, each running the take's command with `--view headless --only <handle>`, or the recorded dev-stage take with its `agents.json` summary as a caption.
