---
status: accepted
---

# A listed project's posture is kept with the instant it can next change

This amends ADR 0021. A list still shows the posture each project's own record stands on now, but it no longer reads every listed project on every list. What a list read is kept in a store, `StandingPostures` (`packages/project/src/standing-posture.ts`), beside the instant the posture can next move by the clock alone (an accepted narrowing whose notice runs out) and the project's last event the read saw. A kept posture serves until that instant. The front-page projection deletes a project's kept row in the same write as any event it applies that can move the posture sooner (a landing, a decision, a ledger entry), and a list writes a row only while the projection has applied no later event of that project than the read saw, so a read taken before an event is never written back after it.

The read is `ProjectApi.standing`, platform-only and on no contract: the public ledger carries no decision times, so it could not say when a narrowing takes effect. The store's default keeps nothing, so the web's dev world and every caller without a store read each project as before; the platform keeps it in D1, in the `standing_postures` table that `apps/platform/migrations/0005_standing_postures.sql` adds.

## Considered Options

- **Keep reading every project on every list** (ADR 0021 as it stood). Always current, but a stage listing a few dozen projects woke each of them on every list, the platform's `/` and the web's `/llms.txt` included.
- **Keep the posture with a fixed time to live.** Simpler, but a landing or a decision that moves it would show late, or the time would be short enough to save little.
- **Put the posture on an outbox event.** ADR 0021 turned this down: a narrowing takes effect by the clock, with no event.

## Consequences

- A list reads only the projects whose kept posture is missing or ran out, at most 8 at once.
- A store that fails to read or write is a miss, never the list's failure, and the miss is logged.
- Migration 0005 is applied by `bun run bootstrap -- --stage <stage>` before a platform build that reads it is deployed. Until then the projection finds no table and leaves its deletes out, and every read is a miss: lists are as slow as before, not broken.
- The badge and the ledger stay one value; a narrowing that takes effect by the clock shows on the list at its instant.
