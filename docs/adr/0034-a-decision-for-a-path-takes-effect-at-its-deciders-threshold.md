---
status: accepted
---

# A decision for a path takes effect at its deciders' threshold

A project's deciders are a list of handles per path in the config folder (`Policy.deciders`, `{handles, paths}`), and a decision takes effect on one decider's choice. One peer platform read in October 2026 keeps who may move a ref as a typed value in the repository itself: a list of keys and a count, per ref, evaluated when the ref is updated, and its web states the rule as one sentence ("1 out of 3 have to accept"). Another answers "may this key push here" per push from the host that keeps the repo. Both put the rule where the clone can read it and derive the sentence from the value. Myr already does the first half: the rule is typed code on main. What it lacks is the count.

The decision: a deciders entry takes an optional `threshold`, default 1. A decision whose paths fall under an entry with a threshold of n takes effect only once n distinct deciders have chosen the same choice; each of them is credited `Decided-by`. Until then the decision is waiting, never refused, and the status line says so: "Waiting on decision dec-000001 · 1 of 2 deciders have accepted · a decider's move". If it expires first, its default takes effect as it does today, so "doing nothing lets nothing in" still holds. The count is evaluated in the decision lifecycle's `transition(state, command, now)` and nowhere else; the Policy page reads "2 of 3 deciders for `src/**`" and Today's row shows "1 of 2" under the default. This is the smallest version: no weighting, no per-kind thresholds, no delegate groups.

## Considered Options

- **A threshold on the project, not the path.** One number is easier to explain, but the rules are already per path, and a project that wants two deciders on `src/**` and one on `docs/**` would have to choose.
- **Evaluate the count at the gate's decider stage instead of in the lifecycle.** The gate would then hold decision state, which Principle 12 keeps in lifecycles; the stage reads the decision's outcome as it does now.
- **A bot as a decider, to make a count up.** An agent holds no account and no credit (ADR 0016); a threshold counts people.

## Consequences

- `Policy.deciders` gains an optional `Schema.Int` field in `packages/protocol`, so the CLI, MCP and the web derive it; a missing field is 1 and no stored policy changes meaning.
- The decision lifecycle's model tests (`packages/project/test/*.model.test.ts`) gain histories where n deciders choose in any order, choose differently, or run out of time, and the planted bug is a decision that takes effect at n minus one.
- The web's status line, Policy page and Today row take the count from the typed value; a count of deciders is a rule, never a score, so the No Score Rule is not touched.
- Not built in the competition window. No new refusal tag and no new dependency.
