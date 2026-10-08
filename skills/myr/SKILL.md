---
name: myr
description: "Contribute to projects on Myr with the `myr` CLI: find an ask, claim it, check your answer locally, push it to your fork, and read the verdict. Use when a repo's remote is on Myr, or when a push was refused with a refusal such as OutOfScope or StaleBase."
metadata:
  managed-by: "myr"
  content-hash: "sha256:bd1f1c815649d83b48ca8dac25f0b3e9b98e54e3a5dd8edc3171261a75e065ca"
---
# Myr

Myr is a git platform where a change lands only by passing a typed gate. A project states each change it wants as an ask; you answer one with a commit pushed to your claim's fork, and the platform checks it and lands it, or answers with refusals that say what to do next.

## The loop

Find an ask with `myr asks`, then, in the project's repo:

1. Read the ask, then claim it: `myr ask <ask>`, then `myr claim <ask>`. The claim prints your fork's remote; add it with `git remote add myr <remote>`.
2. Work inside the ask's territory until its check passes.
3. Run `myr check`. It gives the refusals a push would get, then runs the ask's check and the project's lanes; fix everything it reports.
4. Push your answer to your fork: `git push myr HEAD:main`. The push itself can be refused; follow the answer with `myr status`.
5. Read the verdict on your head: `git fetch myr refs/notes/myr:refs/notes/myr`, then `git notes --ref=myr show HEAD`. It is JSON: match on its `_tag`, and run a refusal's `next`.

A project's own `<project>-contribute` skill and the block in its AGENTS.md give its territories, its run block and its ask kinds.

## Output

A command whose flags list `--json` prints Markdown, or one versioned JSON envelope with `--json`. A command that needs a person's approval runs only with `--yes`, and `--dry-run` prints what it would send.

## Commands

| Command | Flags | What it does |
| --- | --- | --- |
| `myr ask <ask>` | `--project` `--json` | Show one ask in full, with its brief in Markdown for an answerer to read first. Only reads. |
| `myr ask flag <ask>` | `--project` `--reason` `--json` `--dry-run` | Flag an open ask to its deciders with a reason, as a proposal that expires unless a decider accepts it. |
| `myr ask open <ask>` | `--files` `--project` `--json` `--yes` `--dry-run` | Open an ask by landing its file, once its check fails on main by an assertion, twice in the same way. Runs only with `--yes`. |
| `myr asks` | `--project` `--json` | List a project's open asks. Only reads. |
| `myr check` | `--ask` `--project` `--base` `--offline` `--shape-only` `--lane` `--dir` `--json` | Run the gate's checks on your answer locally, before you push. Only reads. |
| `myr claim <ask>` | `--project` `--json` `--dry-run` | Claim an ask: an exclusive, expiring right to answer it, with a fork to push to; claiming it again returns the same claim. |
| `myr credential <operation>` |  | Be git's credential helper: hand git the stored token for a platform. |
| `myr credits` | `--handle` `--json` | Count a person's credits by project, area and role; never a score. Only reads. |
| `myr decide` | `--choice` `--decision` `--note` `--project` `--json` `--yes` `--dry-run` | Take one decision from Today: accept, decline, adopt or revert. Runs only with `--yes`. |
| `myr env set <key>` | `--project` `--acknowledge-short` `--yes` `--dry-run` `--json` | Set a sensitive env item's value from stdin; nobody can read it back. Runs only with `--yes`. |
| `myr env shape` | `--project` `--json` | Show a project's env shape: the public schema of its environment variables, and who set each write-only value; never a value. Only reads. |
| `myr evidence <ref>` | `--project` `--json` | Show the log a failing lane left, by the logRef its verdict names, to the answer's own claimant and the project's deciders only; the last 256 KiB. Only reads. |
| `myr finish` | `--ask` `--base` `--head` `--project` `--requestId` `--json` `--yes` `--dry-run` | Finish a passing answer with a decider's own commits on top; they are checked again, and credited with Finished-by when it lands. Runs only with `--yes`. |
| `myr fork` | `--project` `--json` `--dry-run` | Make the caller's working fork of a project, or return it if it exists. |
| `myr front` | `--kind` `--reserved` `--json` | List the open asks across every project, each saying whether the caller may take it; optionally of one kind, or held for newcomers or people. Only reads. |
| `myr hook <event>` | `--json` | Answer a harness hook (session-start, pre-tool-use, stop) with the gate's policy. Only reads. |
| `myr init` | `--project` `--import` `--branch` `--yes` `--dry-run` `--push` `--no-push` `--json` | Make this repo, or a public HTTPS repo, a project: find its checks, write its config and push. Runs only with `--yes`. |
| `myr land` | `--base` `--head` `--message` `--project` `--requestId` `--json` `--yes` `--dry-run` | Land a decider's own change from their working fork, after the same checks an answer passes. Runs only with `--yes`. |
| `myr landing` | `--project` `--sha` `--json` | Show one landing on a project's main: the ask it answered, the people it credits and its verdict. Only reads. |
| `myr ledger` | `--project` `--json` | Show a project's ledger: its layers, counts, commitments, releases and posture changes. Only reads. |
| `myr login` | `--url` `--profile` `--token-stdin` `--no-browser` `--no-git-config` `--json` | Sign in to a platform; git and this CLI then use its token. |
| `myr logout` | `--profile` `--json` | Forget a platform's stored token. |
| `myr mcp` |  | Serve the platform's tools over MCP on stdio. |
| `myr projects` | `--json` | List every project on the platform, with its posture and how many asks it has open. Only reads. |
| `myr propose` | `--files` `--project` `--sealed` `--territory` `--want` `--json` `--dry-run` | Propose an ask, optionally with a sealed answer; the proposal expires unless a decider accepts it. |
| `myr release` | `--ask` `--project` `--json` `--dry-run` | Release the caller's claim on an ask, so anyone may claim it again. |
| `myr schema <command>` | `--json` | Print the JSON Schema of a command's payload. Only reads. |
| `myr status` | `--project` `--json` | Show who the caller is, and their claims and answers, in one project or in every one. Only reads. |
| `myr submit` | `--ask` `--base` `--head` `--project` `--requestId` `--json` `--dry-run` | Offer the commit `head`, built on `base`, as an answer to a claimed ask; the receipt says it is being checked, and it lands if it passes. |
| `myr today` | `--project` `--json` | Show the caller's Today: the decisions to take, held to their budget, each with its evidence and a safe default. Only reads. |
| `myr verdict` | `--ask` `--head` `--project` `--json` | Show the verdict on an answer to an ask, for its latest head or the one named; held-back checks show one bit per area. Only reads. |
| `myr vouch` | `--handle` `--note` `--project` `--verdict` `--json` `--yes` `--dry-run` | Vouch for a person, or denounce them, by landing a line in the project's vouch file. Runs only with `--yes`. |
| `myr why <location>` | `--project` `--json` | Explain a line: the ask, the answer and the people that landed it. Only reads. |

## MCP

`myr mcp` serves the platform's contracts as MCP tools over stdio, with your stored token.

## Refusals

Instead of landing an answer, the platform answers with refusals. Git prints them on its `remote:` lines, `myr check` and `myr status` print them, and the verdict note holds them as JSON. Each one has a `_tag`, `retryable` (whether trying the same thing again can help) and `next` (the command to run next). The refusals about an answer's files arrive together, so one push hears about all of them.

| `_tag` | Retryable | `next` | What to do |
| --- | --- | --- | --- |
| `NotClaimed` | yes | `myr claim <ask>` | Claim the ask, then push again. |
| `ClaimLapsed` | yes | `myr claim <ask>` | Your claim lapsed after a spell without a push: claim the ask again if it is still open. |
| `NotVouched` | no | `myr status` | Ask a member of the project to vouch for you. |
| `CapReached` | yes | `myr status` | Release a claim you hold, or land one, before you take another. |
| `AskFull` | yes | `myr asks` | Someone else holds the claim: pick another ask. |
| `NoAsk` | no | `myr asks` | Push to the fork your claim gave you, which names its ask. |
| `RepoBusy` | yes | `git push` | Push again. |
| `DirectPush` | no | `myr asks` | Main moves only by a landing: push your answer to your claim's fork. |
| `AskBlocked` | yes | `myr asks` | Wait for the asks it names to land, or answer one of them first. |
| `Denounced` | no | `myr status` | The project's vouch file denounces you: it takes no claims or proposals from you. |
| `OutOfScope` | no | `myr check` | Undo your changes to the paths it names: they are outside the ask's territory. |
| `TouchedJudge` | no | `myr check` | Undo your changes to the paths it names: they decide what the checks do. |
| `Weakened` | no | `myr check` | Take the marker out, or give it a reason for a decider to weigh; never raise a ratchet. |
| `PrivatePathInPublicTree` | no | `myr check` | Take the held-back paths it names out of your answer. |
| `ReachedInternals` | no | `myr check` | Import the other module only through its public files. |
| `StaleBase` | yes | `git pull --rebase` | Main moved: rebase onto it, resolve the conflicts it names, and push again. |
| `StaleLayer` | yes | `myr status` | Nothing: the answer is checked again. |
| `ChecksFailed` | no | the command that reproduces the failure | Run `next` to see the failure, fix it, and push again. |
| `HeldBackFailed` | no | `myr status` | A held-back check failed; you see only its area and suite. Fix the behaviour and push again. |
| `AttemptsExhausted` | yes | `myr status` | Wait until `resetsAt`: you used every attempt on that area's held-back checks for now. |
| `Flake` | yes | `myr status` | Nothing: the check failed and then passed on the same tree, and the platform runs it again. |
| `VerifierBlocked` | yes | `myr status` | Nothing: the platform could not run the checks, and runs them again. |

## No fence yet

Norms that nothing checks yet. Keep them; the gate does not refuse an answer that breaks one.

- Keep an answer to its ask's want. The gate holds the files you change to the territory, but nothing measures how much you change inside it.
- Name the agent you work through. A landing carries an `Assisted-by:` trailer for the agent your harness's environment names; a harness that names none goes unnamed.
