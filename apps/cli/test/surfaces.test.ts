import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { AskId, CommitSha, RepoPath } from "@repo/protocol/ids";
import { StaleBase } from "@repo/protocol/refusal";
import { Effect, Schema } from "effect";

import { session } from "./stdio.ts";

const ask = AskId.make("fix-parser");

const base = CommitSha.make("1111111111111111111111111111111111111111");

const main = CommitSha.make("2222222222222222222222222222222222222222");

const head = CommitSha.make("3333333333333333333333333333333333333333");

const refusal = new StaleBase({
  base,
  conflicts: [RepoPath.make("src/a.ts")],
  main,
});

/** Contracts whose answers always meet a moved main. */
const stale = Contracts.toLayer({
  listAsks: () => Effect.succeed({ asks: [] }),
  submitAnswer: () => Effect.fail(refusal),
});

const clientInfo = { name: "test", version: "0.0.0" };

const initialize = (protocolVersion: string) => ({
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: { capabilities: {}, clientInfo, protocolVersion },
});

const Initialized = Schema.Struct({ protocolVersion: Schema.String });

/** A tools/call result whose one content block is JSON text. */
const ToolResult = Schema.Struct({
  content: Schema.Tuple([
    Schema.Struct({
      text: Schema.fromJsonString(Schema.Unknown),
      type: Schema.Literal("text"),
    }),
  ]),
  isError: Schema.Boolean,
});

describe("the CLI's MCP server over stdio", () => {
  it.effect("agrees each session-based protocol a client asks for", () =>
    Effect.gen(function* () {
      const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

      const agreed = yield* Effect.forEach(versions, (version) =>
        session(stale, [initialize(version)]).pipe(
          Effect.flatMap((replies) =>
            Schema.decodeUnknownEffect(Initialized)(replies.get(1))
          ),
          Effect.map((result) => result.protocolVersion)
        )
      );

      expect(agreed).toStrictEqual(versions);
    })
  );

  it.effect("answers discovery in the stateless 2026-07-28 protocol", () =>
    Effect.gen(function* () {
      const replies = yield* session(stale, [
        {
          id: 1,
          jsonrpc: "2.0",
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": clientInfo,
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            },
          },
        },
      ]);

      const discovered = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ supportedVersions: Schema.Array(Schema.String) })
      )(replies.get(1));

      expect(discovered.supportedVersions).toContain("2026-07-28");
    })
  );

  it.effect("returns a refusal as JSON that keeps its tag", () =>
    Effect.gen(function* () {
      const replies = yield* session(stale, [
        initialize("2025-11-25"),
        { jsonrpc: "2.0", method: "notifications/initialized" },
        {
          id: 2,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: { ask, base, head }, name: "submitAnswer" },
        },
      ]);

      const result = yield* Schema.decodeUnknownEffect(ToolResult)(
        replies.get(2)
      );

      const [{ text }] = result.content;

      expect(result.isError).toBeTruthy();
      expect(text).toHaveProperty("_tag", "StaleBase");
      expect(yield* Schema.decodeUnknownEffect(StaleBase)(text)).toStrictEqual(
        refusal
      );
    })
  );
});
