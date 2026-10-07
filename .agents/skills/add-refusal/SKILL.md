---
name: add-refusal
description: Playbook for adding a refusal, a member of the closed union the platform answers with instead of landing or acting. Use when a contract, a gate stage or the git gateway needs a new way to say no, or when changing an existing refusal's fields.
---

# Add a refusal

Refusals are a closed union and a public contract (principle 3). Harnesses match on `_tag`, read `retryable` and run `next`, so a new member is cheap and a changed one breaks callers. A `_tag` is renamed only with an alias: keep the old tag decoding beside the new one. No alias exists yet, so the first rename designs it, with a test that the old tag still decodes.

A step marked "from W<n>" names code a later build wave adds.

## 1. Name it

- Read the union in `packages/protocol/src/refusal.ts`. Reuse a member when one already says it.
- Name the tag in PascalCase, in `GLOSSARY.md` words (`StaleBase`, `OutOfScope`).
- Pick its group: the comment-headed block it joins, and its entry in `groups`. Shape refusals accumulate, so one push hears every one at once. A new group is a new block and a new `groups` entry.
- Decide whether retrying the same thing can succeed later (`RepoBusy` can, `OutOfScope` can't), and which `<cli>` or `git` command the reader runs next.

Done when you can write its one-line doc comment and its `next` command.

## 2. Pin it in the closed-union test

Add the tag and its `retryable` to the table in `packages/protocol/test/refusal.test.ts` that says the union is closed. Run `npx vitest run test/refusal.test.ts` in `packages/protocol`.

Done when that test fails by an assertion that names the new tag.

## 3. Add the class

In `packages/protocol/src/refusal.ts`:

- `export class <Tag> extends Schema.TaggedError<<Tag>>()("<Tag>", { … }) {}`, with a doc comment in glossary words.
- Spread `...Retryable` or `...Final`. Either fixes `retryable` for the tag and adds the optional `at` (a path and a line). `retryable` and `next` are fields, not statics, because Effect's MCP server sends only what the schema encodes.
- `next`: spread `...nextIs(cli("<command>"))` when the command needs no ids. Otherwise add a `static readonly of` that builds it from them, as `NotClaimed.of(ask)` does. `cli()` takes the command name from `Brand`.
- Leave out `message`. Without one, MCP sends the encoded JSON.
- Give it only fields its reader may see (principle 7). A held-back check names its area and suite, never a case or an input. Wire fields follow AGENTS.md "Effect traps".
- Add it to its group's array, which puts it in the `Refusal` union in the same position.

Done when the only typecheck error in `packages/protocol` is the missing reason in `render.ts`.

## 4. Render it

Add its reason to `reason` in `packages/protocol/src/render.ts`: a lowercase clause, shown on git's `remote:` lines, in the CLI and in MCP text. `protocol/render` is the one renderer, and `Match.typeTags` makes typecheck name a missing reason.

## 5. Add its example

Add one instance to `examples` in `packages/protocol/test/examples.ts`, in union order. The round-trip, render and group tests then cover it.

Done when every test in `packages/protocol` passes, step 2's included.

## 6. Give it to its contracts and its raisers

- Add it to the `error` union of every contract in `packages/protocol/src/contracts.ts` that can give it, and list them in the report.
- Raise it where the decision is made: a gate stage in `packages/gate/src/stages/` (from W2), the gateway in `packages/git/src/gateway.ts`, or a contract's logic.
- Give each raiser a test that produces the refusal, red first.

Done when each contract that lists it has a path that raises it, and a test for that path.

## 7. Regenerate the reference

Run `bun run gen`, which rewrites `docs/reference/refusals.md` from the union, and commit it.

Done when `bun run gen:check` passes.

## 8. Gate

`bun run fix`, then `bun run verify`; fix the cause, never weaken the fence.

## Report

- The tag, its group, `retryable`, `next` and its fields.
- Its reason as rendered.
- Every contract whose error union gained it, and every place that raises it.
- Each test added, and that each was seen red first.
- Whether `docs/reference/refusals.md` changed, and any tag renamed (with its alias).
