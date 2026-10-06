---
status: accepted
---

# Lifecycles are pure transitions run per DO call

Claim and landing state are each a lifecycle: a pure `transition(state, command, now)` function (`ClaimLifecycle`, `LandingLifecycle`). Each Durable Object call hydrates state, runs one transition, persists the row and an outbox entry, then settles side effects. Deadlines run on DO alarms, never on in-memory timers. Pure transitions can be model-tested over generated histories.

## Considered Options

- **XState 6 with `@xstate/effect`.** Both were alphas, released on Oct 3 and Oct 1, 2026, and snapshot restore was not supported yet. Revisit after the competition.

## Consequences

They are called lifecycles, never "deciders", although the code pattern goes by that name elsewhere: in the glossary a **Decider** is a person.
