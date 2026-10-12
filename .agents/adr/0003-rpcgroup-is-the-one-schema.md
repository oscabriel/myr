---
status: accepted
---

# An Effect `RpcGroup` is the one schema

`packages/protocol` defines every operation once, as an `Rpc` in an Effect `RpcGroup` with payload, success and error schemas plus annotations. Everything else is derived from it with `bun run gen`: server handlers, the web client, CLI commands, MCP tools, skills, JSON Schema and the refusal docs. We chose `RpcGroup` because:
- the contract and handler split is native: the group is schemas only, and `group.toLayer(handlers)` implements it;
- `stream` is native on `Rpc.make`, which serves the Project DO's live views;
- `omit`, `merge` and `prefix` give each surface its own subset;
- its annotations use the same keys Effect's MCP `Tool` reads.

## Considered Options

- **`HttpApi` → OpenAPI → Forge**, tried on Oct 6, 2026 and rejected for the window:
  1. It loses streaming beyond SSE and loses refusal identity: refusals become per-status error classes, without a static `retryable`.
  2. It has no MCP or skill target.
  3. Its CLI generator is cf's own, and the commands it emits are bound to Cloudflare's auth.
  4. Its SDK generator, Fern, rejects `_tag` discriminants when two or more tags share a status.
  5. Nothing is on npm ([forge#6](https://github.com/cloudflare/forge/issues/6)).
  6. It needs Docker and a 1.3 GB generator image.
- **Rat Stack's `packages/capability` as the source**, with `RpcGroup` as one projection of it. It passes all 59 of its tests on our Effect pin, but it lacks native `stream` and subsets, and it would put borrowed code at the centre of the product. It is the fallback if the port below is not green by hour 2 of Oct 7.

## Consequences

- The CLI-flag and MCP-tool algorithms are ported from [Rat Stack](https://github.com/joelhooks/rat-stack) at `fba26d8` (MIT): `to-command.ts` l.20–207 and `to-toolkit.ts` l.59–94, about 220 lines, into `protocol/{cli,mcp}`. They are recorded in `PROVENANCE.md` (ADR 0013).
  - Amended (2026-10-07): that record is gone (ADR 0013's note); `protocol/{cli,mcp}` each carry Rat Stack's MIT notice in their own header.
- Wire schemas use `Schema.Int` or `Schema.Finite`, never bare `Schema.Number`, and `Schema.optionalKey`, never `Schema.optional`. Effect's `Schema.toJsonSchemaDocument`, which `McpServer` uses for tool schemas, turns `Schema.Number` into an `anyOf` that admits the strings `"Infinity"`, `"-Infinity"` and `"NaN"`, and turns `Schema.optional(Schema.String)` into string-or-`null`.
- Every `effect/rpc` API is marked `@stability unstable`, so each package that uses one allows it explicitly in `allowedUnstableApis`.
- A public REST SDK, if one is wanted later, comes from an `HttpApi` projection of the `RpcGroup`, not from a second source.

## Amended (2026-10-08)

There is no `bun run gen` and no generated `skills/`, `plugins/` or `docs/reference/` (ADR 0011's note). Every surface still derives from the group, in code: the platform's handlers and the web's client from the contracts, the CLI's commands and the MCP tools through the ported projections in `protocol/{cli,mcp}`, and the CLI's command list as `commandDocs` in `@repo/agent-kit`, which the platform's skill, the CLI's MCP prompt and the web's `/llms.txt` all read. `packages/protocol/test/mcp.test.ts` holds every MCP tool's schemas free of JSON Schema leaks. The `capability` fallback was never needed: the port passed within its first quarter hour.
