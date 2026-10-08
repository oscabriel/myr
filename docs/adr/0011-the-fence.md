---
status: accepted
---

# The fence: compiler first, then lint; verify is the authority

> **Superseded in part (2026-10-07).** On the user's decision, the repo dropped every part of this fence whose only job was to police the agents building it: the hook policy (`scripts/hooks/vcs-policy.ts` and its Claude Code, Cursor and pi adapters), the escape count (`scripts/debt.ts` against `debt.baseline.json`), the repo's own lint rules (`tools/oxlint/fence/`), the test that held AGENTS.md's table to its enforcers, the import-direction check (`imports:check`), the generated reference and distribution (`docs/reference/`, `skills/`, `plugins/` and `gen:check`), the repo's playbooks, and the planned `scripts/acceptance.ts`. `bun run verify` is now the lockfile check, lint and format, typecheck, tests, `brand:check` and `bytes:check`, and it is still the authority. Compiler first, then lint, then a test still orders how a rule is held; a rule with none of them is held by review, and an escape still carries its reason after ` -- `. The record below is kept as it was decided.

Each rule this repo keeps is held by the strongest enforcer available. First, make the mistake unrepresentable in types; then catch it with lint; then with a test; prose is the last rung. Git hooks are early feedback only; `bun run verify` and CI are the authority. The repo is built fast and mostly by agents, and a rule nothing checks drifts under that load. The fence also dogfoods the product: its judge closure, weakening and ratchet apply to this repo first.

## Considered Options

- **The full test suite in pre-commit.** Too slow for an agent sprint. Git hooks, when they come, run lint, format check and typecheck; tests run in `verify` and CI.
- **A `no-comments` lint rule.** Rejected: agents need room for workaround notes.

## Consequences

- Every escape (`oxlint-disable`, `@effect-diagnostics`, `@ts-expect-error`) carries a reason after ` -- `. `scripts/debt.ts` counts escapes against `debt.baseline.json` in `verify`, and the count rises only with the maintainer's sign-off.
- One hook policy (`scripts/hooks/vcs-policy.ts`), wired into Claude Code, Cursor and pi, refuses the usual ways around hooks (`--no-verify`, `commit -n`, `core.hooksPath` overrides, `LEFTHOOK=0` and `lefthook uninstall`), `git push`, `wrangler delete`, cf `delete` and `revoke`, cf's project commands and reads of the closed `.env` files.
- Until the deadline there is no lefthook and no CI workflow: the harness hooks give the early feedback, `bun run verify` is the authority, and `scripts/acceptance.ts` stands in for CI by running `verify` on a cold install.
- A deploy is never a way around a red gate: `infra/deploy.ts` refuses without an explicit stage and runs smoke tests after.
- `AGENTS.md` lists each principle with the check that holds it. Where the check and the prose disagree, the check wins.
