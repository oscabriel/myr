---
status: accepted
---

# Where each ask stands is folded on the web from the project's public events

The web shows, for each ask, who holds it, each answer checked (its rounds), the latest outcome, whether it landed and whose move that leaves, and for a family its children's marks and "n of N landed". None of that is a new contract. It comes from one pure fold, `askStates(events)` (`apps/web/src/features/shared/ask-progress.ts`), over the `watch` replay of the project's public events that the project and answer pages already read, held once per project in `projectEventsAtom` (`apps/web/src/client/events.ts`). A claim sets the claimant and a release, a lapse or the ask's close clears it; each `Judged` is a round; a new claim starts the latest outcome over while the earlier rounds stay. A family's N is the parent's stored `blockedBy` (from `showAsk`), less the delete child, never the listing's remaining blockers. Whose move it is follows from the latest outcome alone: a refusal is the answerer's, a decision or a finish a decider's, a check the platform's, and an ask waiting on another that ask's.

A landing seen while the page is open settles its mark once (the stamp). The first settled read records the highest event number it holds; a later read stamps an ask only when its close is numbered after that, or, where the page polls, when the previous read did not have it landed. A replay that already holds the landing never stamps.

## Considered Options

- **New fields on the listing or a per-ask progress read.** Exact and cheap per page, but each is a new public contract on every surface, the CLI's and MCP's included, for what the event stream already says.
- **A family's N from the listing's remaining blockers.** It shrinks as children land, so "3 of 6" would read "3 of 3".
- **Stamping every landed mark on load.** The stamp would mean nothing: it marks a landing that happened while you watched.

## Consequences

- Each page that folds reads its project's whole replay once when it mounts, so its cost grows with the project's events; the follow then starts from the replay's last number, and a page reads its other keys once more after the replay so nothing that happened between them is missed.
- The web cannot say when a claim runs out or which patch each round pushed, since no event carries them; the pages show neither.
- The fold is pure and replays to the same answer, which `apps/web/test/events.test.ts` holds.
- The front page reads the replay only for projects with a family on the page.
