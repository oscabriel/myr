---
status: accepted
---

# The fence: compiler first, then lint; verify is the authority

Each rule this repo keeps is held by the strongest enforcer available. First, make the mistake unrepresentable in types; then catch it with lint; then with a test; prose is the last rung. Git hooks are early feedback only; `bun run verify` and CI are the authority. The repo is built fast and mostly by agents, and a rule nothing checks drifts under that load. The fence also dogfoods the product: its judge closure, weakening and ratchet apply to this repo first.

## Considered Options

- **The full test suite in pre-commit.** Too slow for an agent sprint. Hooks run lint, format check and typecheck; tests run in `verify` and CI.
- **A `no-comments` lint rule.** Rejected: agents need room for workaround notes.

## Consequences

- Every escape (`oxlint-disable`, `@effect-diagnostics`, `@ts-expect-error`) carries a reason after ` -- `. `scripts/debt.ts` counts escapes against `debt.baseline.json` in `verify`, and the count rises only with the maintainer's sign-off.
- One hook policy refuses the usual ways around hooks: `--no-verify`, `commit -n`, `core.hooksPath` overrides, `LEFTHOOK=0` and `lefthook uninstall`. It is wired into each agent harness the repo uses.
- A deploy is never a way around a red gate: `infra/deploy.ts` refuses without an explicit stage and runs smoke tests after.
- `AGENTS.md` lists each principle with the check that holds it. Where the check and the prose disagree, the check wins.
