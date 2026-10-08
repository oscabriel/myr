/**
 * `<cli> mcp` beside its tools, forked over stdio as a harness
 * spawns it, in MCP's stateless 2026-07-28 protocol: an ask's brief is a
 * resource read through the CLI's `Client`, and the platform's skill is the
 * prompt `contribute`.
 */
import { describe, expect, it } from "@effect/vitest";
import { commandDocs } from "@repo/agent-kit/command-doc";
import { readManaged } from "@repo/agent-kit/generated-file";
import { platformSkill } from "@repo/agent-kit/platform";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { Ask, AskListing } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { AskId, ProjectName, RepoPath } from "@repo/protocol/ids";
import { unanswered } from "@repo/protocol/testing";
import { Effect, Layer, Option, Schema } from "effect";

import { session } from "./stdio.ts";

const project = ProjectName.make("datekit");

const fixWeek = AskId.make("fix-week");

const want = "week reads the ISO week of a date";

/** fix-week as `showAsk` returns it. */
const askWire = {
  askedBy: "dora",
  blockedBy: [],
  brief: { want },
  check: Schema.encodeSync(CheckSpec)(
    CheckSpec.cases.RedThenGreen.make({
      path: RepoPath.make(`test/${fixWeek}.test.ts`),
    })
  ),
  file: `${Brand.configDir}/asks/${fixWeek}.ask.ts`,
  id: fixWeek,
  kind: "fix",
  openedAt: "2026-10-07T12:00:00.000Z",
  openedIn: "4444444444444444444444444444444444444444",
  project,
  state: "open",
  territory: { module: ".", paths: ["src/week.ts"] },
} as const;

const brief = `# ${fixWeek}\n\n${want}.\n`;

/** A platform with datekit's one open ask, fix-week. */
const datekit = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("showAsk", ({ ask }) =>
    ask === fixWeek
      ? Effect.succeed({ ask: Schema.decodeSync(Ask)(askWire), brief })
      : Effect.die(`the test asked for ${ask}`)
  ),
  Contracts.toLayerHandler("listAsks", () =>
    Effect.succeed({
      asks: [
        Schema.decodeSync(AskListing)({
          ask: fixWeek,
          blockedBy: [],
          claimed: false,
          kind: "fix",
          territory: ".",
          want,
        }),
      ],
    })
  )
);

const meta = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
};

/** A stateless 2026-07-28 request over stdio: each carries its `_meta`. */
const request = (
  id: number,
  method: string,
  params: Readonly<Record<string, Schema.Json>> = {}
) => ({ id, jsonrpc: "2.0", method, params: { _meta: meta, ...params } });

const TextContents = Schema.Struct({
  contents: Schema.Array(
    Schema.Struct({
      mimeType: Schema.optionalKey(Schema.String),
      text: Schema.String,
      uri: Schema.String,
    })
  ),
});

const PromptText = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  messages: Schema.NonEmptyArray(
    Schema.Struct({
      content: Schema.Struct({
        text: Schema.String,
        type: Schema.Literal("text"),
      }),
      role: Schema.Literal("user"),
    })
  ),
});

/**
 * The platform's skill body, from agent-kit's command list: the contracts'
 * commands and the hand-written ones.
 */
const skillBody = platformSkill({ commands: commandDocs(Contracts) }).pipe(
  Effect.map(([file]) =>
    Option.match(
      Option.flatMap(Option.fromNullishOr(file), ({ content }) =>
        readManaged(content)
      ),
      { onNone: () => "", onSome: ({ body }) => body }
    )
  )
);

describe("the CLI's MCP server over stdio, beside its tools", () => {
  it.effect("reads an ask's brief through the Client, in Markdown", () =>
    Effect.gen(function* () {
      const uri = `${Brand.urlScheme}ask/${project}/${fixWeek}`;

      const replies = yield* session(datekit, [
        request(1, "server/discover"),
        request(2, "resources/read", { uri }),
      ]);

      expect(replies.get(2), "resources/read gave a result").toBeDefined();

      const read = yield* Schema.decodeUnknownEffect(TextContents)(
        replies.get(2)
      );

      expect(read.contents).toStrictEqual([
        { mimeType: "text/markdown", text: brief, uri },
      ]);
    })
  );

  it.effect("gives the platform's skill as the prompt contribute", () =>
    Effect.gen(function* () {
      const body = yield* skillBody;

      const replies = yield* session(datekit, [
        request(1, "server/discover"),
        request(2, "prompts/get", { name: "contribute" }),
        request(3, "prompts/get", {
          arguments: { project },
          name: "contribute",
        }),
      ]);

      expect(
        [replies.get(2), replies.get(3)],
        "prompts/get gave results"
      ).not.toContain(undefined);

      const bare = yield* Schema.decodeUnknownEffect(PromptText)(
        replies.get(2)
      );

      const named = yield* Schema.decodeUnknownEffect(PromptText)(
        replies.get(3)
      );

      const text = named.messages.map(({ content }) => content.text).join("\n");

      expect(body).toContain(`# ${Brand.name}`);
      expect(bare.messages.map(({ content }) => content.text)).toStrictEqual([
        body,
      ]);
      expect(text).toContain(body);
      expect(text).toContain(fixWeek);
    })
  );
});
