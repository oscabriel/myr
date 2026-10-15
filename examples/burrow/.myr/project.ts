import { check, kinds, project, territory } from "@myr/cli/rules";

// The run block `myr init` found in this repo's own files, each command with
// where it was found; deciders, kinds and the ratchet added since.
export default project({
  deciders: { "**": ["okafor", "lin-h", "oscar"] },
  kinds: [kinds.fix, kinds.lintToZero, kinds.ratchetDown, kinds.migrate],
  modules: territory.fromWorkspaces(),
  ratchets: {
    // Module-level bindings in a package's src/, which our own lint rule
    // warns about: six when the rule landed, one per package. The count may
    // only fall; at zero the rule becomes an error.
    "no-module-level-mutable-state": check.ratchet.count(
      "bun run lint --format json",
      { rule: "burrow/no-module-level-mutable-state" }
    ),
  },
  run: {
    checks: {
      // checks.lint from lefthook.yml
      lint: "bun run lint",
      // checks.types from lefthook.yml
      types: "bun run typecheck",
      // checks.unit from lefthook.yml
      unit: "bun test",
    },
    // setup inferred from bun.lock
    setup: "bun install --frozen-lockfile",
    // test from lefthook.yml
    test: "bun test {path}",
  },
});
