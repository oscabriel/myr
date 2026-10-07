---
name: add-port
description: Playbook for adding a port, the one job-named service an outside dependency enters through, with a memory adapter, real adapters and a shared contract suite. Use when code needs storage, a Cloudflare binding, a process, the network or another beta API, or when an existing port needs a new adapter.
---

# Add a port

A port is the one place a dependency enters (principle 6): a job-named `Context.Service` in the package that owns the job, a `/memory` adapter for tests, real adapters beside it, and one contract suite every adapter passes. `RepoHost` is the reference. Read `packages/artifacts/src/repo-host.ts`, `packages/artifacts/src/repo-host/memory.ts` and `packages/artifacts/test/repo-host-contract.ts` before you start.

For a Workers binding's types and behaviour, run `bash scripts/vendor-agent-sources.sh` and read Wrangler and Miniflare in `.agent_sources/workers-sdk/packages/`.

## 1. Name the job and its owner

- Name the port for the job (`RepoHost`, `CheckRunner`, `Lander`), never for the vendor. Its Cloudflare resources carry job names too (principle 5).
- Pick the one package that owns the job. Apps import packages, never the reverse (principle 6).
- When a port for this job exists, add an adapter instead: go to step 3.

Done when you can name the owning package and the adapters the port needs.

## 2. Write the port

In `packages/<pkg>/src/<port>.ts`:

- `export class <Port> extends Context.Service<<Port>, { readonly <op>: (…) => Effect.Effect<A, E> }>()("<pkg>/<Port>") {}`;
- its errors as `Schema.TaggedError` classes beside it, named for what went wrong in the job (`RepoNotFound`, `HostBusy`). Map the vendor's errors to them inside each adapter;
- its values as Schemas or branded types, so a caller needs no vendor package to use it.

Keep the operations few and named for what callers need. Say in a doc comment what is idempotent and what is not atomic, as `RefOutcome` says a `RepoHost.push` is never atomic across refs.

Done when the port file imports no adapter.

## 3. Write the contract suite, one case at a time

In `packages/<pkg>/test/<port>-contract.ts`, export `describe<Port>(adapter, layer)`, as `describeRepoHost` does. Each case drives behaviour through the port only, so every adapter runs the same cases. For each case: write it, run it against the `/memory` adapter, watch it fail by an assertion, then make it pass (the `tdd` skill).

Done when the suite covers every operation, its errors included.

## 4. Write the adapters

- `/memory` in `packages/<pkg>/src/<port>/memory.ts` is a `Layer` over in-process state, deterministic and with no I/O (`RepoHostMemory = Layer.sync(RepoHost, make)`).
- Real adapters sit beside it, named for their mechanism: `binding`, `rest`, `sqlite`, `local`, `isogit`, `worker`, `bun` or `json` (AGENTS.md "Nouns").
- An adapter is Worker-safe unless its file is `local.ts` or `bun.ts`, or sits under a `local/` or `bun/` folder. Only those may import `node:child_process`, `@effect/platform-bun`, `@effect/platform-node` or OpenTUI. `bun run imports:check` follows Worker imports through package subpaths to hold this (rule `worker-host`).
- Each adapter runs the suite from its own test file: `describe<Port>("<adapter>", <Layer>)`. An adapter for a live service also runs it against a fake built over the memory adapter, and against the real service only when an env flag opts in.

Done when every adapter passes the suite.

## 5. Export each adapter by its own subpath

- The package's `package.json` `exports` maps `./<port>` to `./src/<port>.ts` and `./<port>/<adapter>` to each adapter. From W2, a wildcard `"./*": "./src/*.ts"` entry covers new files.
- Callers import the adapter they compose, as in `@repo/artifacts/repo-host/memory`. The port file never imports or re-exports an adapter; `bun run imports:check` refuses that (rule `adapter-through-port`).
- An adapter that needs an unstable Effect module, such as `effect/sql` or `effect/process`, needs a per-path `allowedUnstableApis` override in `tsconfig.base.json`. Loosening it takes the user's sign-off (AGENTS.md "Fence").

Done when `bun run imports:check` passes.

## 6. Compose it

Provide the real adapter at the app's composition root (`apps/platform/src/platform.ts` for the platform Worker) and the memory adapter in tests.

Done when the app typechecks with the port provided and its tests pass.

## 7. Gate

`bun run fix`, then `bun run verify`; fix the cause, never weaken the fence.

## Report

- The port, its operations and errors, and the package that owns it.
- Each adapter, its host (Worker, or Bun and Node), and its subpath.
- The contract suite's cases, and which adapters ran it, live runs included or not.
- Where it is composed.
- Any `allowedUnstableApis` or dependency change, with its sign-off.
