---
name: add-check-kind
description: Playbook for adding a check kind, the shape an ask's check takes (redThenGreen, lintToZero, ratchet, migrate). Use when asks need a new way to judge an answer, or when changing how an existing kind runs or is classified.
---

# Add a check kind

A check kind says what makes an ask's check red on main, what green for the right reason means, and which gamed answers it must refuse. It passes through five places: the schema, the builder maintainers call in their config folder, the runner, the gate's classification, and an example project.

A step marked "from W<n>" names a package a later build wave adds. If it is missing, stop at the last step whose files exist and say so in the report.

## 1. Define the kind

Write three concrete cases before any code:

- **red**: how the check fails on main, twice the same way, by an assertion or a count above zero (`GLOSSARY.md` "Red first");
- **green**: what an answer changes that turns it green;
- **gamed**: an answer that turns it green without the change, such as a null answer, a skipped test or a disabled rule.

Also list its inputs: the paths, commands, rules or counts a maintainer gives. A new kind is a new word: add it to `GLOSSARY.md`'s "Check kind" entry (the `domain-modeling` skill).

Done when each of the three cases is a small tree or recorded run you could commit as a fixture.

## 2. Add the schema member

Add a tagged member to `CheckSpec` in `packages/protocol/src/domain/check.ts` (from W2). Its fields are what the maintainer gives, never facts the platform derives. Wire fields follow AGENTS.md "Effect traps".

Done when a round-trip test of the new member in `packages/protocol/test/domain.test.ts` (from W2) passes, seen red first.

## 3. Add the builder

Add `check.<kind>(…)` to `packages/sdk/src/index.ts` (from W2), returning plain data. Test it in `packages/sdk/test/sdk.test.ts`: build a config that uses it, and decode the result with `Policy`.

Done when the decoded `Policy` holds the new `CheckSpec` member.

## 4. Run and classify it

In `packages/checks/src/` (from W2):

- the kind's helpers in `kinds.ts`, including its part of `checkVersion`. Verdicts are cached by tree and check version (principle 8), so a change to how a kind runs is a new version;
- red first and the right reason in `classify.ts` (`redFirst`, `classifyRun`);
- a static weak-shape check in `weakShapes` for each gamed case a check file can show.

Test each against step 1's fixtures: red on main is accepted, green is green for the right reason, and each gamed case is refused.

Done when every step 1 case has a passing test here.

## 5. Teach the gate

In `packages/gate/src/`:

- how a failure of this kind classifies in `classify.ts` (from W2): failed checks, a flake, a blocked verifier or a stale base;
- if the kind counts something, its ratchet in `stages/ratchet.ts` (from W2);
- if an answer could weaken it with a marker (a disable comment), that marker in `defaultMarkers` in `markers.ts` (from W4).

Done when gate tests cover the kind's classification, and each marker or ratchet it adds refuses a weakened answer with `Weakened`.

## 6. Show it in an example

Add an ask of this kind to an example project under `examples/` (from W5), in the project's config folder under `asks/`, with a check that is red on that project's main.

Done when the example's ask opens: its check is red on main twice the same way.

## 7. Regenerate the reference

Run `bun run gen`; the JSON Schema under `docs/reference/` gains the new member. Commit it.

Done when `bun run gen:check` passes.

## 8. Gate

`bun run fix`, then `bun run verify`; fix the cause, never weaken the fence.

## Report

- The kind, its inputs, and its red, green and gamed cases.
- The `CheckSpec` member and the builder's signature.
- How it is classified, its weak shapes and weakening markers, and how its check version changes.
- The example ask, and whether it opened.
- Each test added, and that each was seen red first; any step stopped at a missing later-wave package.
