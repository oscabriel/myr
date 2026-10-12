---
status: accepted
---

# A listed project's posture is read from the project when it is listed

The project list, the platform's `/` and the web's `/llms.txt` show each project's posture beside its name. Those rows come from the front-page projection, which hears a project only through its outbox events, and a project's standing posture changes without any event: a first config stands at once with no ledger row, a widening needs no decision, and an accepted narrowing takes effect when its notice runs out, by the clock. So a list could say "Open" while the project's own ledger said "Open with sealed evidence".

A list now reads each listed project's posture from that project's own record at list time: the anonymous ledger read, whose `posture` is the one standing now, the same value the ledger page shows. One helper in `@repo/project`, `withStandingPosture`, lays it over the projection's rows, a few projects at once. The platform's list and `/`, and the web's offline dev world, all call it. The projection's posture column stays as the fallback, kept for a project the platform never made or one whose ledger read fails, and that failure is logged.

## Considered Options

- **Write a `PostureChanged` row for a first config or a widening.** A row needs a decision to name, it changes what the public ledger records, and a project that exists today gets one only when something next wakes it.
- **Project a new outbox event into the front page.** Existing rows stay wrong until each project emits again, and a narrowing that takes effect by the clock still lags behind it.
- **Show posture only on the ledger page.** The badge on the list is what a visitor sees first.

## Consequences

- Each list makes one ledger read per listed project, and the ledger is read whole for one field. A stage that lists a few dozen projects wakes each of them on every list. ADR 0025 amends this: what a list read is kept until the posture can next change, so a list reads only the projects whose kept posture is missing or ran out.
- Nothing is migrated or replayed: once deployed, a list shows the right posture for data already there.
- The badge and the ledger are one value, so a narrowing that takes effect by the clock shows on the list at once.
- Posture comes through the visibility port's own ledger, so a host without the visibility cartridge still lists every project as Open.
