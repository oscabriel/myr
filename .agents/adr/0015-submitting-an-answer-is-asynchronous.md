---
status: accepted
---

# Submitting an answer is asynchronous: the push hears the cheap stages, and the rest arrives later

An answer is offered by `git push` to the claim fork, or by the `submitAnswer` contract (the CLI's `submit`, the MCP tool). Either way, the call runs only the gate's first two stages: the parse (who may push what, and where) and the shape (territory, judge custody, weakening, reached internals). A clean answer then starts the `Answer` Workflow and returns at once with the outcome `Checking`, which git shows as `remote: checking <ask> at <head>; follow with <cli> status`. The merge, the project's own commands in a container, the held-back checks and any human stage run after the call has returned. Their outcome arrives as the verdict note on the answer's head, in `status` and `watch`, and through MCP. A container check takes minutes, and a push must not hold a request open that long.

## Considered Options

- **Hold the push open until the verdict.** Every refusal would then reach `git push` output, but one request would hold the git client, the gateway and a container for minutes, and a dropped connection would leave the pusher with nothing to read.
- **Accept the push and say nothing until a later read.** Shape refusals are cheap and the most common kind, so they belong in git's own output, before the answerer moves on.

## Consequences

- Every offer carries a `requestId` (a push's is `push-<head>-<handle>`), so offering the same answer again returns the same receipt and starts no second run.
- A push hears every stage-1 refusal at once (ADR 0006). `submitAnswer` fails with one error, so it returns the first of them.
- Refusals from the later stages, such as `ChecksFailed`, `Flake`, `StaleBase` from a re-merge, or `HeldBackFailed`, never appear in the push's own output. They are read from `status`, `watch`, MCP or the verdict note (`git fetch` of the notes ref, then `git notes show`).
- An answer's `Outcome` says where it stands meanwhile: `Checking`, then `Landed`, a waiting state, or `Refused` (ADR 0006's amendment).
