# The fence plugin's upstreams

The `fence` plugin holds the repo's own lint rules. Three are ports; each file keeps a header naming its source. They are ours to change, and upstream is never synced in. Licence texts are in `LICENSES/`.

| Rule | Upstream | Commit | Licence |
| --- | --- | --- | --- |
| `no-module-level-mutable-state` | [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `scripts/oxlint-plugin-patterns.ts` l.28–43 (`workspacePath`, `isRuntimeSource`) and l.621–677 (`isModuleScopedVar` and the rule) | `fba26d8` | MIT, `LICENSES/rat-stack.MIT.txt` |
| `no-manual-effect-runtime-in-tests` | [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `scripts/oxlint-plugin-effect-tests.ts`, which Rat Stack adapted from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts` | Rat Stack `fba26d8`; Rat Stack's `PROVENANCE.md` names no t3code commit, so the licence was copied from t3code at `05d4042` | MIT, `LICENSES/rat-stack.MIT.txt` and `LICENSES/t3code.MIT.txt` |
| `debt-ledger` (issue 101) | [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `scripts/oxlint-plugin-debt-ledger.ts` | `fba26d8` | MIT, `LICENSES/rat-stack.MIT.txt` |

## Our changes

### `no-module-level-mutable-state`

- Only this rule is ported from `oxlint-plugin-patterns.ts`. Its other rules (`acquire-release-constructs-in-acquire-body`, `contract-binding-matches-name`, `watch-effect-actors`) are not, by the AGENTS.md rejections.
- A named export registered in the `fence` plugin, not upstream's `rat-stack-patterns` plugin.
- `workspacePath` reads the path string alone. Upstream made the path relative to a repo root it found from its own location (`import.meta.dirname` and `node:path`, under a `nodeBuiltinImport` escape). Ours strips oxlint's working directory (`context.cwd`) by string, then finds the whole `(apps|packages)/<name>/src/` shape anywhere in what is left. A copy of that layout anywhere (the fixtures under `fixtures/packages/`, a temporary tree) counts as runtime source, and a folder named `apps` or `packages` above the checkout does not. No `node:path` import, so no escape.
- `isRuntimeSource` drops upstream's `.svelte` exclusion: this repo has no Svelte.
- A `declare let` or `declare var` is skipped: it is ambient and holds no state.
- Kept as upstream wrote them: the `let` check by scope (`module` or `global`), `isModuleScopedVar` for a hoisted `var`, the `moduleState` message id and its text, and the rule's description.

### `no-manual-effect-runtime-in-tests`

- A named export registered in the `fence` plugin, not upstream's `effect-tests` plugin.
- `manualRunnerName`, which returned the runner's name for a message that never used it, is `isManualRunner`, a boolean. `EFFECT_RUNTIME_METHODS` is a `ReadonlySet`.
- Kept as Rat Stack wrote them: the test-file pattern (`*.test.*`, `*.spec.*`), the twelve `Effect.run*` methods plus `ManagedRuntime.make`, the report on the callee, the `manualRunner` message id and its text, and the description.
- Compared with t3code's rule at `05d4042`, Rat Stack's port (and so ours) matches a plain `Effect.<method>` or `ManagedRuntime.make` member call only, without t3code's `effect/Option` helpers that also unwrap `(Effect).runPromise`, `Effect!.runPromise` and `Effect["runPromise"]`; it reports by message id rather than naming the runner; and it has no per-file `maxOccurrences` debt ceiling. That ceiling stays out, because an escape here carries a reason and `debt-ledger` counts it.

### `debt-ledger`

See its row in `PROVENANCE.md` (issue 101).

## Tests

`packages/config/test/oxlint-fence.test.ts` runs the real oxlint binary over `fixtures/` with `fixtures/oxlint.json` (the fence plugin, both rules at error, every category off) and checks each rule's `{ruleId, line, messageId}` on a bad fixture and silence on a good one. It also lints a temporary copy of the bad fixtures with the root `oxlint.config.ts`, so a config change that switches a rule off for the files it guards fails the test. Root lint, format and typecheck ignore `fixtures/`, so each fixture keeps the faults its test points at.
