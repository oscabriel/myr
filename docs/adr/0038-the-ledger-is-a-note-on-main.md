---
status: proposed
---

# The ledger is a note on main

"Export is `git clone`": code, asks and credit trailers leave with a clone, and verdict notes take one more fetch of `refs/notes/*` (ADR 0010). What a clone does not carry is the ledger (the project's layers, counts, commitments, releases and posture changes) and its decisions; both live in the platform's record alone. One peer platform read in October 2026 keeps every social object as commits in the repository under refs of its own, so a clone carries the code, the discussion and the rule set at once. Myr's rule set is already on main; the ledger is the gap.

The decision: the platform writes the ledger as a note on each landing that changes it, under `refs/notes/ledger`, append-only, in the same typed form the Ledger page and `projectPolicy` read. The fetch that brings the verdict notes brings the ledger too, so PRODUCT's sentence covers it with no new step. Only the platform writes these refs: a fork takes branches only (Principle 7, `apps/platform/test/gateway.test.ts`), so a contributor can neither forge nor erase an entry. Decisions follow the same path later, in a note of their own, once their lifecycle's record is settled enough to be a public shape.

## Considered Options

- **Commits under a ref of their own** (`refs/ledger`), as the peer's objects are. A commit DAG allows concurrent writers to merge, which the ledger has not got: one platform writes it in order. Notes are what git already fetches with the verdicts.
- **A file in the config folder on main.** It would make every ledger change a landing on `main`, which moves the project's history for a bookkeeping entry, and an answer could then touch it.
- **Leave the ledger on the platform** and say so. This is where the docs stand in the window: PRODUCT names the ledger as the one record not yet in the clone.

## Consequences

- The Lander's bookkeeping push (ADR 0014) gains one more note, each on its own, after `main` has moved.
- The Ledger page names the ref the note is fetched from, as the verdict notes are named.
- `packages/project` gains a writer of the note and a reader that decodes it with Schema (Principle 2), and a test that the note's entries equal the ledger the platform serves.
- Not built in the competition window; no dependency is added.
