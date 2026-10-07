# Provenance

Code from other projects enters as ports: copied with attribution, then ours to change (ADR 0013). One row per port, with its source, commit, licence and our changes. Licence texts are in `LICENSES/`.

## Ports

| Our file | Origin | Licence | Our changes |
| --- | --- | --- | --- |
| `tools/oxlint/anti-slop/` | [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22` | MIT, `LICENSES/anti-slop.MIT.txt` | None; vendored by its own install script. See `UPSTREAM.md` there. |
| `packages/protocol/src/cli.ts` | [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `packages/capability/src/to-command.ts` l.14–247 at `fba26d8` | MIT, `LICENSES/rat-stack.MIT.txt` | Projects an `Rpc` whose payload is a struct, not a capability, and calls it through an `RpcClient`. `--json` is always offered. A refusal prints `protocol/render`'s text on stderr, or its encoded JSON on stdout with `--json`, and the command fails with it. String flags check their value with the field's schema, so the parser refuses a malformed value by its flag. The description comes from the `Description` annotation. Dropped: `--yes` and approval, the reserved-field guards, and the `as never` casts. |
| `packages/protocol/src/mcp.ts` | [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `packages/capability/src/to-toolkit.ts` l.18–146 at `fba26d8` | MIT, `LICENSES/rat-stack.MIT.txt` | Projects an `RpcGroup`'s Rpcs, not capabilities: the payload, success and error schemas become the tool's. Handlers call each Rpc through an `RpcClient`, passing the payload alone. The description comes from the `Description` annotation. Dropped: the empty-input dynamic tool, approval, the hint annotations and the file-wide diagnostics escape. |
| `tsconfig.base.json` (compiler options and the Effect diagnostics map) | [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `tsconfig.base.json` at `fba26d8` | MIT, `LICENSES/rat-stack.MIT.txt` | `importFromBarrel` dropped (unknown to `@effect/tsgo` 0.48.1); `types` emptied, so each package opts into its host's types; `@effect/platform-bun` added to `namespaceImportPackages`; `outdatedApi`, `unstableApiUsage` and `experimentalApiUsage` raised to `error`; `allowedUnstableApis` emptied and granted per path through `overrides`. |

## Ideas, no code

| Idea | From | Where it lives |
| --- | --- | --- |
| The stateless 2026-07-28 MCP request (`_meta` keys plus `Mcp-Method`, `Mcp-Name` and `MCP-Protocol-Version` headers) driven through `HttpRouter.toWebHandler` | Effect's `packages/effect/test/ai/McpServer/v2026_07_28.test.ts` and `TestUtils/McpHttpHarness.ts` | `packages/protocol/test/mcp.ts` |
| A release-age gate and exact pins on every install | Rat Stack's `pnpm-workspace.yaml` (`minimumReleaseAge`, `minimumReleaseAgeExclude`) | `bunfig.toml` |
