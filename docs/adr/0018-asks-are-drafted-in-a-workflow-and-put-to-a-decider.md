---
status: accepted
---

# Asks are drafted by the platform's agent in a Workflow, run red first, and put to a decider

A member who can say what a project wants, but not write its ask, proposes the want with a draft. The platform's agent then writes the ask for them. A draft round is one run of the existing `Answer` Workflow under params tagged `Draft`. Its steps are a context step, which picks files from the canonical tree at the landed commit within a byte budget and never reads a layer, then up to three attempts, then a settle. Each attempt makes one model call through Workers AI's `AI` binding, recorded as a step, and one rehearsal: red first on the Checker, the same preparation `accept` runs, which lands nothing. The model is the `DRAFT_MODEL` var, and no key or secret is involved. A refused rehearsal feeds its rendered refusal and the last 4 KB of its output into the next attempt. The model returns fields only (the ask's id, want, context, territory, the test's path and source, a rationale). Code renders the `.ask.ts` file from those fields, so only the test file is the model's own text, and that test may not sit in the config folder. A settled draft reaches a decider as an `OpenProposal` decision. Its evidence is the drafted files, the red-first signature, the model, the attempt and the rationale. Accepting it runs the unchanged `accept`, red first again on the then-current `main`. The landing credits the proposer (`Asked-by`) and the decider (`Decided-by`), and discloses the agent with `Assisted-by: <cli>-drafter:<model> (verified)`.

## Considered Options

- **A container harness with a provider secret** (a coding agent in a Checker-like container, calling a model provider with a key). It could edit and run code freely, but it adds a secret to set per stage, a second container image, and a harness that writes code into the ask file. That stays a later step, which could reach the same binding through an intercepted host.
- **Drafting inside the Project Durable Object's call.** A model call takes 30 to 60 s and a rehearsal minutes; a DO call that long blocks the project, and a retried call would ask the model again. A Workflow step records the model's answer, so a replay asks nothing more.
- **The `agents` SDK.** It brings 17 peer dependencies and a deprecated MCP agent, and it adds nothing a recorded step and a binding call do not already do.

## Consequences

- Nothing a draft writes lands without a decider: the draft's own rehearsal only reports, and `accept` is the one path to `main`.
- A draft round's instance is one per project, proposal and round, so a round started twice runs once. A complete round is never started again, since that would ask the model again. A round that errored is.
- Workers AI does not hold a model to the JSON Schema it is asked for. The reply is decoded with Effect Schema whatever the model claims, and a reply that does not decode is a spent attempt.
- The prompt's policy digest is built from the public policy only, so a layer's name, readers and paths never reach a model.
- Drafts are `fix` asks only for now. A project with no `fix` kind settles its draft as failed at once.
- Drafting has its own rate limit (`DRAFT_LIMIT`), and each draft costs at most three model calls and six Checker runs, plus two on accept.
