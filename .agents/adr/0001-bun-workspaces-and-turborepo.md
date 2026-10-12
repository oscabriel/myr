---
status: accepted
---

# Bun workspaces and Turborepo, not pnpm

The repo is a Bun workspace with a dependency catalog, and Turborepo runs its tasks. Bun is the maintainer's default, and `bun build --compile` turns the CLI into single binaries. Turborepo caches tasks and costs one file.

## Considered Options

- **pnpm.** The Effect team uses it, and Cloudflare's `cloudflare.config.ts` tooling does not support Bun. That second reason went away once Wrangler became the deploy tool (ADR 0002).
- **Workspace scripts with no task runner.** Nothing would be cached, so every check reruns on every change.

## Consequences

We keep pnpm's supply-chain guarantees by configuration rather than by tool: `--frozen-lockfile` in CI and in acceptance runs, exact pins, a minimum release age, and `trustedDependencies` for install scripts.

Rat Stack, which we port from (ADR 0013), says not to replace pnpm with Bun. That rule is about cold installs of Rat Stack's own template. The guarantees it protects are the ones kept above.

## Amended (2026-10-08)

There is no CI workflow and no acceptance script (ADR 0011's note). The lockfile guarantee is `bun run lockfile:check` (`bun install --frozen-lockfile --dry-run`), the first step of `bun run verify`. `bunfig.toml` keeps exact pins and a one-day minimum release age, and the root `package.json` names no `trustedDependencies`.
