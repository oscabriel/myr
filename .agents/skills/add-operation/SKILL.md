---
name: add-operation
description: Playbook for adding an operation, one contract the platform serves over RPC, MCP, the CLI and the web. Use when adding a contract, or when widening an existing contract's payload, success or refusals.
---

# Add an operation

An operation is one contract: an `Rpc` in the one schema. Every surface is a projection of it (principle 4), so the work is the contract, its server logic and its tests; the surfaces follow from its annotations.

A step marked "from W<n>" names code a later build wave adds. If that path is missing, use the stand-in the step names and say so in the report. `Rpc` and `RpcGroup` source is in `node_modules/effect/src/rpc/`; for Effect's own tests and examples, run `bash scripts/vendor-agent-sources.sh` and read `.agent_sources/effect`.

## 1. Pin it in the group test

From W2, `packages/protocol/test/contracts.test.ts` pins every contract in a table: its tag in group order, its flags, audience and surfaces, and its error subset. Add the new contract's row there, and its example payload and success to `packages/protocol/test/contract-examples.ts` (both from W2; reuse the ids in `packages/protocol/test/examples.ts`). Run `npx vitest run test/contracts.test.ts` in `packages/protocol`.

Done when that test fails by an assertion that names the new tag. Before W2, `packages/protocol/test/annotations.test.ts` is the only group test: say so in the report.

## 2. Define the contract

- In `packages/protocol/src/contracts.ts`, write `export class <Name> extends Rpc.make("<tag>", { payload, success, error }) {}` and add it to `Contracts`' `RpcGroup.make(…)`. The tag is a camelCase verb: `listAsks`, `submitAnswer`.
- Build the payload and the success from the branded ids in `packages/protocol/src/ids.ts` and the domain schemas in `packages/protocol/src/domain/` (from W2). The success is a `Schema.Struct`, because an MCP output schema needs an object at its root.
- `error` is a `Schema.Union` of the refusals this contract can give, a subset of `Refusal` in `packages/protocol/src/refusal.ts`, so each handler stays exhaustive. A refusal the union lacks comes first, through the `add-refusal` skill. Leave out `Unauthenticated`: the `Authenticated` middleware adds it.
- Every wire field follows AGENTS.md "Effect traps".

Done when `bun run typecheck` inside `packages/protocol` reports nothing but `Contracts.toLayer` calls that lack the new tag.

## 3. Annotate it

Each annotation in `packages/protocol/src/annotations.ts` is a `Context.Reference` with a default, set with `.annotate(Key, value)` on the `Rpc`:

- `Description`: one sentence in `GLOSSARY.md` words. Every surface shows it.
- `Audience`: `public`, `signedIn` or `decider`. Only a `public` contract will answer a caller with no credential (from W3). `decider` only documents the rule: the logic checks the caller against the project's deciders and refuses with `NotDecider` (from W2), so list it in `error`.
- `Visibility`: `maintainers` when the response may carry what a public reader must not see (principle 7). It only documents and keeps web caches off; the handler leaves those fields out for anyone who isn't a decider.
- `ReadOnly`, `Idempotent` and `Destructive`, each set explicitly. MCP treats a tool without hints as destructive. A write is `Idempotent` only when a replay converges on the same result (principle 8): by a `RequestId`, as `submitAnswer` does, or by its nature, as a holder's re-claim returns the same claim.
- `NeedsApproval` when a person must confirm. The CLI then asks for `--yes` (from W4).
- `Cli` (its command name and positionals) and `Surfaces` (which of `rpc`, `mcp`, `cli` and `web` serve it). MCP is filtered by `Surfaces` from W2, and the CLI reads both from W4.

Done when `packages/protocol/test/annotations.test.ts` and step 1's test pass with the new contract in the group.

## 4. Write the server logic, then the handler

- The logic lives in the owning package, never in the app (principle 6): a method on `ProjectApi` in `packages/project/src/project.ts` (from W2), tested over `/memory` adapters in `packages/project/test/`. A read across every project comes from the front-page projection instead (from W3).
- The handler in `apps/platform/src/handlers.ts` (from W3; until then `apps/platform/src/vacant.ts`) stays thin. It resolves the project, calls it, and fails only with the contract's own refusals.
- `Contracts.toLayer` must name every tag, so each call gains a handler for the new one: the platform's, and the stand-ins tests build (as in `packages/protocol/test/mcp.test.ts`). `bun run typecheck` lists every call that lacks it.

Done when `bun run typecheck` passes and the logic's tests are green.

## 5. Check the projections

Projections live only in `packages/protocol/src/{cli,mcp}.ts` and `apps/*/src/surfaces.ts` (principle 4). They read the group and its annotations, so a new contract usually needs no edit there. Touch `apps/platform/src/surfaces.ts` or `apps/cli/src/surfaces.ts` only for what the group can't express, such as a stream's route.

Done when you can name each surface that serves the contract, and the annotation that put it there.

## 6. Test every surface it is on

Write each test red first: watch it fail by an assertion, then make it pass (the `tdd` skill).

- MCP: `tools/list` shows the tool with its hints, and `tools/call` returns its success and a refusal as typed JSON (`packages/protocol/test/mcp.test.ts`).
- CLI: the command takes the payload as flags and prints the success (`packages/protocol/test/cli.test.ts`).
- RPC: `apps/platform/test/surfaces.test.ts` calls it as the person a bearer token names.

Done when every surface in `Surfaces` has a test that fails without the contract.

## 7. Regenerate the reference

Run `bun run gen` and commit what it writes under `docs/reference/`. Those files come only from the schema; `gen:check` compares them with it.

Done when `bun run gen:check` passes.

## 8. Gate

`bun run fix`, then `bun run verify`; fix the cause, never weaken the fence.

## Report

- The contract's tag, payload, success and refusals.
- Its annotations: audience, visibility, hints, approval, CLI name and surfaces.
- Where its logic and its handler live, and any stand-in used for a later wave's path.
- Each test added, and that each was seen red first.
- The files `bun run gen` changed.
