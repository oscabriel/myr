# Where burrow's lint rule comes from

`rules/no-module-level-mutable-state.ts` is a copy of a rule the repository that holds this example once carried (`tools/oxlint/fence/rules/no-module-level-mutable-state.ts`, removed there on 2026-10-07), which ported it from [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `scripts/oxlint-plugin-patterns.ts` (l.28–43, `workspacePath` and `isRuntimeSource`; l.621–677, `isModuleScopedVar` and the rule) at `fba26d8`. MIT; the licence is `LICENSE-rat-stack.txt` beside this file. The file keeps its header naming the source. It is ours to change, and upstream is never synced in.

## Changes from the copy

- The header points at this folder's licence and this file, not the source repository's.
- The rule is registered in the `burrow` plugin (`index.ts`), not `fence`, and `oxlint.config.ts` sets it to `warn` until the last module-level binding is gone.

Everything else is as copied, including the source repository's own changes from Rat Stack: `workspacePath` reads the path string alone, stripping oxlint's working directory and finding the whole `(apps|packages)/<name>/src/` shape anywhere in what is left (so `packages/<name>/src/` here counts, and folders above the checkout don't); upstream's `.svelte` exclusion is dropped; a `declare let` or `declare var` is skipped. The `let` check by scope, `isModuleScopedVar`, the `moduleState` message and the description are upstream's.

## Tests

`rule.test.ts` runs oxlint's `RuleTester` (from `oxlint/plugins-dev`) over `fixtures/bad.ts` and `fixtures/good.ts`, each named as a file in a package's `src/`, and over the bad fixture named as a test and as a script, where the rule stays silent. The RuleTester needs Node, so `bun run lint:rules` runs it with `node --test`. The lint config ignores `fixtures/`, so each fixture keeps the faults its test points at.
