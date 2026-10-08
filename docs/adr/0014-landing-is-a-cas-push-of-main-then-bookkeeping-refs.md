---
status: accepted
---

# Landing is a CAS push of main, then the bookkeeping refs, each on its own

The platform lands a checked tree as one new commit on canonical `main`, whose parent is the landed SHA the Project DO last recorded, pushed with a plain push: never forced and never atomic. If `main` moved since, storage refuses it, and the landing re-merges onto the new `main` or ends as `StaleBase`. Only once `main` has moved does the platform push its bookkeeping: the mirror ref (ADR 0005) and the verdict note, each in a push of its own. Artifacts has no atomic multi-ref push, and any write token can force-push `main`, so the one push that matters is the compare-and-swap on `main`, and only the platform holds a token that can make it.

## Considered Options

- **One atomic push of `main`, the mirror ref and the note.** This was the earlier design. Artifacts refuses `--atomic` (spike, Oct 6), and its receive-pack advertises no `atomic` capability.
- **`--force-with-lease` on `main`.** It is a compare-and-swap too, but it is a forced push: once the expected value matches, any commit replaces `main`, even one that does not descend from it, so a landing built on the wrong parent would rewrite history instead of failing. A plain push of a commit whose parent is the old tip can only move `main` forward. The Lander uses a lease only for its own compose refs, never for `main`.
- **Bookkeeping first, `main` last.** A mirror or a note naming a commit that never landed would mislead its readers, and Artifacts accepts a notes ref naming a commit the repo lacks, then fails the fetch of that commit.

## Consequences

- The landed SHA in the Project DO, written in the same transaction as the landing record, is the only truth (ADR 0005). The mirror ref and the note may trail `main` for a moment, and nothing decides by them.
- A bookkeeping push that fails stays in the DO's outbox, and the next alarm lands the same request again. The Lander finds its own commit already on `main`, by the commit's `Request-Id` trailer, and writes only what is missing, so a replayed landing never makes a second commit.
- Artifacts fires one push event per ref, so `OnPush` reads the ref and ignores the pushes the platform made.
- Write tokens for a canonical repo never leave the platform. Answers go to forks, and tokens are per repo.
- The serial landing queue lands one request per project at a time. A landing that meets `RepoBusy` waits and tries again, from a second up to five minutes.
