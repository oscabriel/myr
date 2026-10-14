import { describe, expect, it, layer } from "@effect/vitest";
import { commandDocs } from "@repo/agent-kit/command-doc";
import { readManaged } from "@repo/agent-kit/generated-file";
import { platformSkill } from "@repo/agent-kit/platform";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { Contracts, EnvSchemaOf, Surfaces } from "@repo/protocol/contracts";
import type { Contract, ContractOn } from "@repo/protocol/contracts";
import { Ask, AskListing } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import {
  AskId,
  CommitSha,
  DecisionId,
  DiscussionId,
  Handle,
  LaneName,
  ProjectName,
  ProposalId,
  RepoPath,
  keyOf,
  RequestId,
} from "@repo/protocol/ids";
import { CurrentPrincipal, Principal } from "@repo/protocol/principal";
import {
  NotClaimed,
  NotDecider,
  ProjectExists,
  UnknownAsk,
  UnknownCommit,
  UnknownDecision,
  UnknownDiscussion,
  UnknownPath,
  UnknownProject,
  UnknownRevision,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  Array,
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  SchemaAST,
} from "effect";
import type { Rpc } from "effect/rpc";

import { MemorySessions } from "../src/sessions/memory.ts";
import { operatorToken } from "./fake-env.ts";
import { noProjects, origin, served } from "./harness.ts";
import { coreLoopWorld } from "./world.ts";
import type { CoreLoopWorld } from "./world.ts";

const project = ProjectName.make("dora/datekit");

const fixWeek = AskId.make("fix-week");

const nope = AskId.make("no-such-ask");

const nowhere = ProjectName.make("alice/nowhere");

const redThenGreen = LaneName.make("redThenGreen");

const sdk = `${Brand.cliPackage}/rules`;

const start = {
  [`${Brand.configDir}/project.ts`]: [
    `import { kinds, project } from "${sdk}";`,
    ``,
    `export default project({`,
    `  kinds: [kinds.fix],`,
    `  run: { checks: {}, test: "bun test {path}" },`,
    `});`,
    ``,
  ].join("\n"),
  [`${Brand.configDir}/vouched.td`]: "alice\nbob\n",
  "README.md": "datekit: dates, parsed\n",
  "package.json": '{ "name": "dora/datekit", "private": true }\n',
  "src/week.ts": "export const week = (iso: string) => 0;\n",
};

const want = "week reads the ISO week of a date";

const askFiles = Array.make(
  {
    content: [
      `import { kinds, territory } from "${sdk}";`,
      ``,
      `export default kinds.fix.ask({`,
      `  path: "test/${fixWeek}.test.ts",`,
      `  territory: territory.paths("src/week.ts"),`,
      `  want: "${want}",`,
      `});`,
      ``,
    ].join("\n"),
    path: RepoPath.make(`${Brand.configDir}/asks/${fixWeek}.ask.ts`),
  },
  {
    content: [
      `import { expect, it } from "bun:test";`,
      `import { week } from "../src/week.ts";`,
      ``,
      `it("${want}", () => {`,
      `  expect(week("2026-10-07")).toBe(41);`,
      `});`,
      ``,
    ].join("\n"),
    path: RepoPath.make(`test/${fixWeek}.test.ts`),
  }
);

class Seeded extends Context.Service<Seeded, CoreLoopWorld>()("test/Seeded") {}

const seeded = Layer.effect(
  Seeded,
  Effect.gen(function* () {
    const world = yield* coreLoopWorld();
    const dora = world.rpc("dora");
    const doraGit = world.git("dora");

    const made = yield* dora.initProject({ project });
    const home = yield* doraGit.clone(made.remote);

    yield* doraGit.commit(home, "Start datekit", start);
    yield* doraGit.push(home);

    yield* world.script(
      CheckAt.cases.Commit.make({
        commit: yield* world.composed(project, askFiles),
      }),
      redThenGreen,
      ["failed", "failed"]
    );

    yield* dora.openAsk({ ask: fixWeek, files: askFiles, project });

    return world;
  }).pipe(Effect.orDie)
);

const version = "2026-07-28";

const meta = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
  "io.modelcontextprotocol/protocolVersion": version,
};

const routedBy = new Map([
  ["prompts/get", "name"],
  ["resources/read", "uri"],
  ["tools/call", "name"],
]);

const mcpRequest = (
  method: string,
  params: Readonly<Record<string, Schema.Json>>,
  token?: string
) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-method": method,
    "mcp-protocol-version": version,
  });

  const key = routedBy.get(method);
  const routed = key === undefined ? undefined : params[key];

  if (Predicate.isString(routed)) {
    headers.set("mcp-name", routed);
  }

  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return new Request(`${origin}/mcp`, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params: { _meta: meta, ...params },
    }),
    headers,
    method: "POST",
  });
};

const Reply = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
    result: Schema.optionalKey(Schema.Unknown),
  })
);

const replyOf = (response: Response) =>
  Effect.promise(() => response.text()).pipe(
    Effect.map((text) =>
      response.headers.get("content-type")?.includes("text/event-stream") ===
      true
        ? (text
            .split("\n")
            .findLast((line) => line.startsWith("data: "))
            ?.slice("data: ".length) ?? "")
        : text
    ),
    Effect.flatMap(Schema.decodeEffect(Reply))
  );

const resultOf = <S extends Schema.Top>(
  fetch: (request: Request) => Effect.Effect<Response>,
  schema: S,
  method: string,
  params: Readonly<Record<string, Schema.Json>>,
  token = operatorToken
) =>
  fetch(mcpRequest(method, params, token)).pipe(
    Effect.flatMap(replyOf),
    Effect.flatMap(({ error, result }) => {
      expect(error, `${method} failed`).toBeUndefined();

      return Schema.decodeUnknownEffect(schema)(result);
    })
  );

const errorOf = (
  fetch: (request: Request) => Effect.Effect<Response>,
  method: string,
  params: Readonly<Record<string, Schema.Json>>,
  token = operatorToken
) =>
  fetch(mcpRequest(method, params, token)).pipe(
    Effect.flatMap(replyOf),
    Effect.map(({ error }) => error?.message)
  );

const TextContents = Schema.Struct({
  contents: Schema.Array(
    Schema.Struct({
      mimeType: Schema.optionalKey(Schema.String),
      text: Schema.String,
      uri: Schema.String,
    })
  ),
});

const Templates = Schema.Struct({
  resourceTemplates: Schema.Array(
    Schema.Struct({
      mimeType: Schema.optionalKey(Schema.String),
      name: Schema.String,
      uriTemplate: Schema.String,
    })
  ),
});

const Resources = Schema.Struct({
  resources: Schema.Array(
    Schema.Struct({
      mimeType: Schema.optionalKey(Schema.String),
      name: Schema.String,
      uri: Schema.String,
    })
  ),
});

const Prompts = Schema.Struct({
  prompts: Schema.Array(
    Schema.Struct({
      arguments: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            required: Schema.optionalKey(Schema.Boolean),
          })
        )
      ),
      description: Schema.optionalKey(Schema.String),
      name: Schema.String,
    })
  ),
});

const PromptText = Schema.Struct({
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

const ToolResult = Schema.Struct({
  content: Schema.Tuple([
    Schema.Struct({
      text: Schema.fromJsonString(Schema.Unknown),
      type: Schema.Literal("text"),
    }),
  ]),
  isError: Schema.Boolean,
});

const ToolText = Schema.Struct({
  content: Schema.Tuple([
    Schema.Struct({ text: Schema.String, type: Schema.Literal("text") }),
  ]),
  isError: Schema.Boolean,
});

const Answered = Schema.Struct({
  isError: Schema.Boolean,
  structuredContent: Schema.Unknown,
});

const briefUri = (of: ProjectName, ask: AskId) =>
  `${Brand.urlScheme}ask/${keyOf(of)}/${ask}`;

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

type OwnError<R> =
  R extends Rpc.Rpc<
    infer _Tag,
    infer _Payload,
    infer _Success,
    infer Error,
    infer _Middleware,
    infer _Requires
  >
    ? Error["Type"]
    : never;

type Refusing<R> = R extends Rpc.Any
  ? [OwnError<R>] extends [never]
    ? never
    : R["_tag"]
  : never;

interface Provoked<Tag extends string> {
  readonly args: Rpc.Payload<Rpc.ExtractTag<Contract, Tag>>;
  readonly refusal: OwnError<Rpc.ExtractTag<Contract, Tag>>;
}

const base = CommitSha.make("1111111111111111111111111111111111111111");

const head = CommitSha.make("3333333333333333333333333333333333333333");

const requestId = RequestId.make("mcp-refused-0001");

const decision = DecisionId.make("dec-000001");

const untagged = "v9.9.9";

const provoked = {
  claim: {
    args: { ask: nope, project },
    refusal: new UnknownAsk({ ask: nope }),
  },
  decide: {
    args: { choice: "accept", decision, project },
    refusal: new UnknownDecision({ decision }),
  },
  // Keyed by the class: lint keeps "shape" out of code names.
  [EnvSchemaOf._tag]: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  draftAsk: {
    args: { project: nowhere, proposal: ProposalId.make("prop-000001") },
    refusal: new UnknownProject({ project: nowhere }),
  },
  finish: {
    args: { ask: fixWeek, base, head, project, requestId },
    refusal: new NotDecider({}),
  },
  flagAsk: {
    args: { ask: nope, project, reason: "the want names a file" },
    refusal: new UnknownAsk({ ask: nope }),
  },
  fork: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  initProject: {
    args: { project },
    refusal: new ProjectExists({ project }),
  },
  land: {
    args: { base, head, message: "Tidy the week", project, requestId },
    refusal: new NotDecider({}),
  },
  landing: {
    args: { project, sha: head },
    refusal: new UnknownCommit({ sha: head }),
  },
  ledger: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  listAsks: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  listDiscussions: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  listRefs: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  log: {
    args: { at: untagged, project },
    refusal: new UnknownRevision({ rev: untagged }),
  },
  openAsk: {
    args: { ask: nope, files: askFiles, project },
    refusal: new NotDecider({}),
  },
  postDiscussion: {
    args: { body: "Hello", discussion: DiscussionId.make("disc-000001"), project },
    refusal: new UnknownDiscussion({
      discussion: DiscussionId.make("disc-000001"),
    }),
  },
  projectPolicy: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  proposeAsk: {
    args: { project: nowhere, want },
    refusal: new UnknownProject({ project: nowhere }),
  },
  readFile: {
    args: { at: untagged, path: RepoPath.make("README.md"), project },
    refusal: new UnknownRevision({ rev: untagged }),
  },
  readTree: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  release: {
    args: { ask: fixWeek, project },
    refusal: NotClaimed.of(fixWeek),
  },
  showAsk: {
    args: { ask: nope, project },
    refusal: new UnknownAsk({ ask: nope }),
  },
  showDiscussion: {
    args: { discussion: DiscussionId.make("disc-000001"), project },
    refusal: new UnknownDiscussion({
      discussion: DiscussionId.make("disc-000001"),
    }),
  },
  showProposal: {
    args: { project: nowhere, proposal: ProposalId.make("prop-000001") },
    refusal: new UnknownProject({ project: nowhere }),
  },
  status: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  submitAnswer: {
    args: { ask: fixWeek, base, head, project, requestId },
    refusal: NotClaimed.of(fixWeek),
  },
  today: {
    args: { project: nowhere },
    refusal: new UnknownProject({ project: nowhere }),
  },
  verdict: {
    args: { ask: nope, project },
    refusal: new UnknownAsk({ ask: nope }),
  },
  vouch: {
    args: { handle: Handle.make("alice"), project, verdict: "vouch" },
    refusal: new NotDecider({}),
  },
  why: {
    args: { at: untagged, path: RepoPath.make("src/week.ts"), project },
    refusal: new UnknownRevision({ rev: untagged }),
  },
} satisfies {
  readonly [Tag in Refusing<ContractOn<"mcp">>]: Provoked<Tag>;
};

const refusingOnMcp = [...Contracts.requests.values()].filter(
  (rpc) =>
    Context.get(rpc.annotations, Surfaces).includes("mcp") &&
    !SchemaAST.isNever(rpc.errorSchema.ast)
);

const provokedBy = new Map<
  string,
  { readonly args: unknown; readonly refusal: Refusal }
>(Object.entries(provoked));

layer(seeded, { excludeTestServices: true, timeout: "120 seconds" })(
  "the platform's MCP surface, once datekit has fix-week open",
  (test) => {
    test.effect("lists the ask brief as a resource template", () =>
      Effect.gen(function* () {
        const { fetch } = yield* Seeded;

        const { resourceTemplates } = yield* resultOf(
          fetch,
          Templates,
          "resources/templates/list",
          {}
        );

        expect(resourceTemplates).toContainEqual({
          mimeType: "text/markdown",
          name: "ask brief",
          uriTemplate: `${Brand.urlScheme}ask/{project}/{ask}`,
        });
      })
    );

    test.effect("reads an ask's brief as showAsk gives it, in Markdown", () =>
      Effect.gen(function* () {
        const world = yield* Seeded;
        const uri = briefUri(project, fixWeek);

        const { brief } = yield* world
          .rpc("anonymous")
          .showAsk({ ask: fixWeek, project });

        const read = yield* resultOf(
          world.fetch,
          TextContents,
          "resources/read",
          {
            uri,
          }
        );

        expect(read.contents).toStrictEqual([
          { mimeType: "text/markdown", text: brief, uri },
        ]);
      })
    );

    test.effect(
      "answers an ask it does not have with an error naming UnknownAsk",
      () =>
        Effect.gen(function* () {
          const { fetch } = yield* Seeded;

          const message = yield* errorOf(fetch, "resources/read", {
            uri: briefUri(project, nope),
          });

          expect(message).toContain(
            explain([new UnknownAsk({ ask: nope })]).join("\n")
          );
        })
    );

    test.effect("lists the projects as a resource", () =>
      Effect.gen(function* () {
        const { fetch } = yield* Seeded;

        const { resources } = yield* resultOf(
          fetch,
          Resources,
          "resources/list",
          {}
        );

        expect(resources).toContainEqual({
          mimeType: "text/markdown",
          name: "projects",
          uri: `${Brand.urlScheme}projects`,
        });
      })
    );

    test.effect(
      "lists the prompt contribute, described as the skill is, which may name a project",
      () =>
        Effect.gen(function* () {
          const { fetch } = yield* Seeded;

          const { prompts } = yield* resultOf(
            fetch,
            Prompts,
            "prompts/list",
            {}
          );

          const contribute = prompts.find(({ name }) => name === "contribute");

          expect(contribute).toMatchObject({
            arguments: [{ name: "project", required: false }],
            name: "contribute",
          });
          expect(contribute?.description).toMatch(
            new RegExp(
              `^Contribute to projects on ${Brand.name} with the \`${Brand.cli}\` CLI`,
              "u"
            )
          );
        })
    );

    test.effect(
      "gives the platform's skill as contribute, as gen writes it",
      () =>
        Effect.gen(function* () {
          const { fetch } = yield* Seeded;
          const body = yield* skillBody;

          const { messages } = yield* resultOf(
            fetch,
            PromptText,
            "prompts/get",
            {
              name: "contribute",
            }
          );

          expect(body).toContain(`# ${Brand.name}`);
          expect(messages.map(({ content }) => content.text)).toStrictEqual([
            body,
          ]);
        })
    );

    test.effect("adds a named project's open asks to contribute", () =>
      Effect.gen(function* () {
        const { fetch } = yield* Seeded;
        const body = yield* skillBody;

        const { messages } = yield* resultOf(fetch, PromptText, "prompts/get", {
          arguments: { project },
          name: "contribute",
        });

        const text = messages.map(({ content }) => content.text).join("\n");

        expect(text).toContain(body);
        expect(text).toContain(fixWeek);
        expect(text).toContain(briefUri(project, fixWeek));
      })
    );

    test.effect(
      "answers contribute for a project nobody made with an error naming UnknownProject",
      () =>
        Effect.gen(function* () {
          const { fetch } = yield* Seeded;

          const message = yield* errorOf(fetch, "prompts/get", {
            arguments: { project: nowhere },
            name: "contribute",
          });

          expect(message).toContain(
            explain([new UnknownProject({ project: nowhere })]).join("\n")
          );
        })
    );

    test.effect(
      "keeps resources and prompts from a caller with no credential",
      () =>
        Effect.gen(function* () {
          const { fetch } = yield* Seeded;

          const statuses = yield* Effect.forEach(
            [
              mcpRequest("resources/read", { uri: briefUri(project, fixWeek) }),
              mcpRequest("resources/templates/list", {}),
              mcpRequest("prompts/get", { name: "contribute" }),
            ],
            (request) => Effect.map(fetch(request), ({ status }) => status)
          );

          expect(statuses).toStrictEqual([401, 401, 401]);
        })
    );

    test.effect("reads a file at main as structured content", () =>
      Effect.gen(function* () {
        const world = yield* Seeded;
        const { landed } = yield* world.rpc("anonymous").listRefs({ project });

        const result = yield* resultOf(world.fetch, Answered, "tools/call", {
          arguments: { path: "README.md", project },
          name: "readFile",
        });

        const file = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            at: Schema.String,
            binary: Schema.Boolean,
            path: Schema.String,
            text: Schema.String,
            truncated: Schema.Boolean,
          })
        )(result.structuredContent);

        expect(result.isError).toBeFalsy();
        expect(file).toStrictEqual({
          at: landed,
          binary: false,
          path: "README.md",
          text: start["README.md"],
          truncated: false,
        });
      })
    );

    test.effect("lists the root folder at main", () =>
      Effect.gen(function* () {
        const { fetch } = yield* Seeded;

        const result = yield* resultOf(fetch, Answered, "tools/call", {
          arguments: { project },
          name: "readTree",
        });

        const listing = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            entries: Schema.Array(
              Schema.Struct({ name: Schema.String, type: Schema.String })
            ),
          })
        )(result.structuredContent);

        expect(result.isError).toBeFalsy();
        expect(listing.entries).toStrictEqual([
          { name: Brand.configDir, type: "tree" },
          { name: "src", type: "tree" },
          { name: "test", type: "tree" },
          { name: "README.md", type: "blob" },
          { name: "package.json", type: "blob" },
        ]);
      })
    );

    test.effect(
      "refuses a file main does not have with UnknownPath, its tag kept",
      () =>
        Effect.gen(function* () {
          const world = yield* Seeded;
          const missing = RepoPath.make("src/month.ts");

          const { landed } = yield* world
            .rpc("anonymous")
            .listRefs({ project });

          const commit = yield* Effect.fromNullishOr(landed);

          const result = yield* resultOf(
            world.fetch,
            ToolResult,
            "tools/call",
            {
              arguments: { path: missing, project },
              name: "readFile",
            }
          );

          const [{ text }] = result.content;

          expect(result.isError).toBeTruthy();
          expect(text).toHaveProperty("_tag", "UnknownPath");
          expect(
            yield* Schema.decodeUnknownEffect(UnknownPath)(text)
          ).toStrictEqual(new UnknownPath({ commit, path: missing }));
        })
    );

    test.effect(
      "refuses a log page of more than 100 commits by its input",
      () =>
        Effect.gen(function* () {
          const { fetch } = yield* Seeded;

          const result = yield* resultOf(fetch, ToolText, "tools/call", {
            arguments: { limit: 101, project },
            name: "log",
          });

          const [{ text }] = result.content;

          expect(result.isError).toBeTruthy();
          expect(text).toMatch(/^Invalid parameters for tool 'log'/u);
          expect(text).toContain("between 1 and 100");
          expect(text).toContain('["limit"]');
        })
    );

    test("provokes every contract MCP serves that can refuse", () => {
      expect(refusingOnMcp.map(({ _tag }) => _tag)).toStrictEqual(
        expect.arrayContaining(["showAsk", "submitAnswer", "initProject"])
      );
      expect([...provokedBy.keys()].toSorted()).toStrictEqual(
        refusingOnMcp.map(({ _tag }) => _tag).toSorted()
      );
    });

    test.effect.each(refusingOnMcp.map(({ _tag }) => _tag))(
      "returns %s's refusal as JSON its error union decodes",
      (tag) =>
        Effect.gen(function* () {
          const { fetch } = yield* Seeded;
          const rpc = yield* Effect.fromNullishOr(Contracts.requests.get(tag));
          const row = yield* Effect.fromNullishOr(provokedBy.get(tag));

          const args = yield* Schema.encodeUnknownEffect(
            Schema.toCodecJson(rpc.payloadSchema)
          )(row.args);

          const result = yield* resultOf(fetch, ToolResult, "tools/call", {
            arguments: args,
            name: tag,
          });

          const [{ text }] = result.content;

          // Before decoding, so a call that wrongly succeeded fails here, not as a decode error.
          expect(result.isError, `${tag} was not refused`).toBeTruthy();

          const refusal = yield* Schema.decodeUnknownEffect(rpc.errorSchema)(
            text
          );

          expect(text).toMatchObject({
            _tag: row.refusal._tag,
            next: row.refusal.next,
            retryable: row.refusal.retryable,
          });
          expect(refusal).toStrictEqual(row.refusal);
        })
    );
  }
);

const sessions = MemorySessions.layer({
  "alice-token": Handle.make("alice"),
  "bob-token": Handle.make("bob"),
});

const callerName = CurrentPrincipal.useSync((principal) =>
  Principal.match(principal, {
    Anonymous: () => "anyone",
    Person: ({ handle }) => handle,
  })
);

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

const naming = Layer.mergeAll(
  noProjects,
  Contracts.toLayerHandler("showAsk", () =>
    Effect.map(callerName, (who) => ({
      ask: Schema.decodeSync(Ask)(askWire),
      brief: `# ${fixWeek}\n\nRead by ${who}.`,
    }))
  ),
  Contracts.toLayerHandler("listProjects", () =>
    Effect.succeed({
      projects: [
        Schema.decodeSync(ProjectListing)({
          openAsks: 1,
          posture: "open",
          project,
        }),
      ],
    })
  ),
  Contracts.toLayerHandler("listAsks", () =>
    Effect.map(callerName, (who) => ({
      asks: [
        Schema.decodeSync(AskListing)({
          ask: fixWeek,
          blockedBy: [],
          claimed: false,
          kind: "fix",
          territory: ".",
          want: `listed for ${who}`,
        }),
      ],
    }))
  ),
  sessions
);

describe("the platform's MCP resources and prompts, over scripted contracts", () => {
  it.effect("read through the Client the tools use, as the caller", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(naming);

      const brief = yield* resultOf(
        fetch,
        TextContents,
        "resources/read",
        { uri: briefUri(project, fixWeek) },
        "alice-token"
      );

      const prompt = yield* resultOf(
        fetch,
        PromptText,
        "prompts/get",
        { arguments: { project }, name: "contribute" },
        "bob-token"
      );

      expect(brief.contents.map(({ text }) => text)).toStrictEqual([
        `# ${fixWeek}\n\nRead by alice.`,
      ]);
      expect(
        prompt.messages.map(({ content }) => content.text).join("\n")
      ).toContain("listed for bob");
    })
  );

  it.effect("reads the projects as a Markdown table", () =>
    Effect.gen(function* () {
      const { fetch } = yield* served(naming);
      const uri = `${Brand.urlScheme}projects`;

      const read = yield* resultOf(
        fetch,
        TextContents,
        "resources/read",
        { uri },
        "alice-token"
      );

      expect(read.contents).toHaveLength(1);
      expect(read.contents[0]).toMatchObject({
        mimeType: "text/markdown",
        uri,
      });
      expect(read.contents[0]?.text).toContain(
        [
          "| project | posture | open asks | landed |",
          "| --- | --- | --- | --- |",
          `| ${project} | open | 1 | never |`,
        ].join("\n")
      );
    })
  );
});
