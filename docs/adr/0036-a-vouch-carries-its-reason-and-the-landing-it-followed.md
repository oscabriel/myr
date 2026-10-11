---
status: accepted
---

# A vouch carries its reason and the landing it followed

A vouch is a line in the project's vouch file on main: a handle, and whether the line denounces. One peer platform read in October 2026 makes a vouch a public, revocable record with an optional reason and a pointer to the work it was made after, offered to a maintainer right after a contribution lands, and with no number attached: it changes what a person may do, not how they rank. That is the vouch Myr's glossary describes, with two fields missing.

The decision: a vouch line takes an optional `reason` and an optional `for`, the SHA of the landing it followed. The Policy page shows each as the line it is ("vouched by ines-v, for 9b1c3e5 (format-ordinal)"), with the landing linked, and never a count. After that, Today's "Newcomers to welcome" gains a one-tap Vouch whose consequence reads "adds a line to the vouch file and lands it with you as Decided-by": it is a decider's choice, so it is one of the web's permitted writes, and the line lands through the gate from the decider's working fork like any other change to the config folder. A denouncement stays what it is (it bars proposals) and is shown as its line, never as a warning label beside a name. There is no decay: the record window (30 days) already expires what trust reads.

## Considered Options

- **A vouch as a trailer on the landing** (`Vouched-by`). It would ride with the clone, but a vouch is about a person, not a tree, and it must be revocable; a line on main can be removed by a landing, a trailer cannot.
- **A count of vouches shown beside a handle.** "Vouched for by 3 people" is a score; PRODUCT's "No scores" and DESIGN's No Score Rule forbid it.
- **Vouches visible only to the signed-in.** The vouch file is public code on main; hiding its reading would make the web say less than the clone.

## Consequences

- The config schema in `packages/protocol` (the vouch line's parse) gains two optional fields; an old file reads as before.
- The Policy page's vouch rows gain a reason and a linked landing when present; `apps/web/test` holds that no count of vouches is drawn.
- The Today choice is a new contract (a decider's decision whose effect is a landing of the vouch file), in a later ADR of its own if it needs one; the line format needs none.
- Not built in the competition window; no dependency is added.
