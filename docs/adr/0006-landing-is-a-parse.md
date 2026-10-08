---
status: accepted
---

# Landing is a parse: a cost-ordered gate and a closed refusal union

Every push is treated as unknown input. The gate runs its stages in order of cost (the claim, the territory, judge custody and weakening, the merge, the project's own commands, then held-back checks) and narrows the push either to a checked tree, which the platform lands, or to refusals. Refusals are a closed union of `Schema.TaggedError` classes, so people, agents and code can all branch on them.

## Considered Options

- **Free-text check failures**, as most CI reports them. A person can read them, but an agent or a script has to guess what went wrong and what to do next.
- **One refusal per push.** An agent with three shape problems would need three pushes to learn about them.

## Consequences

- Each refusal carries a static `retryable`, a `next` command and an optional `at: {path, line}`. It carries no `message` field: Effect's MCP server renders a tool error as text only when its message is non-empty, so without one, MCP clients get the structured error.
- Text for git `remote:` lines, the CLI and MCP comes from one renderer, `protocol/render`.
- Stage-1 (shape) refusals accumulate, so one push gets every shape problem at once. Costly stages stop at the first failure. The `ng` line names the first tag; `remote:` lines, CLI JSON and MCP JSON list them all.
- The union is a public contract. A `_tag` is renamed only with an alias.
- `Flake` and `VerifierBlocked` never count against the answerer.

## Amended (2026-10-08)

- **`PatchId` is the platform's own**, not `git patch-id`: SHA-256 over the answer's change set as sorted `path`, blob-before, blob-after lines (an absent blob as empty), computed with WebCrypto in a Worker that has no diff engine (`packages/git/src/patch-id.ts`). It ignores commit order and moves only when a blob the answer touches moves, which is when a held-back lane must run again; a verdict records it, and only held-back results may carry over on an unchanged one. Open: the change set is taken against the answer's own base, so a re-merge onto a `main` that changed one of those files keeps the same id.
- **Waiting is not refusing.** An answer's `Outcome` is `Checking`, `Landed`, `WaitingOnParent`, `AwaitingFinish`, `AwaitingDecision` or `Refused`. The three waiting states carry no refusal: nothing failed, and the answer needs no new push. Only `Refused` carries refusals, all from the cheapest failing stage.
- Stages 0 and 1 answer inside the push; the merge, the project's commands, held-back checks and the human stage answer afterwards (ADR 0015).
