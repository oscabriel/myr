/**
 * The platform's MCP surface beside its tools, through its fetch
 * handler composed as the Worker's is (the core loop's world), once dora has made
 * datekit and opened fix-week: an ask's brief is a resource, the projects
 * are one, the platform's skill is the prompt `contribute`, and every tool
 * whose contract can refuse returns its refusal as typed JSON. Requests are
 * MCP's stateless 2026-07-28 ones, built as `harness.ts` builds a tool call.
 */
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
  Handle,
  LaneName,
  ProjectName,
  RepoPath,
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
  UnknownProject,
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

const project = ProjectName.make("datekit");

const fixWeek = AskId.make("fix-week");

/** An ask datekit never opened, and a project nobody made. */
const nope = AskId.make("no-such-ask");

const nowhere = ProjectName.make("nowhere");

/** The lane an ask's `redThenGreen` check runs in. */
const redThenGreen = LaneName.make("redThenGreen");

/** Where the config folder's sdk is imported from, as a maintainer writes it. */
const sdk = `${Brand.cliPackage}/rules`;

/** The project as dora first pushes it: one source file, the config folder, the vouches. */
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
  "package.json": '{ "name": "datekit", "private": true }\n',
  "src/week.ts": "export const week = (iso: string) => 0;\n",
};

const want = "week reads the ISO week of a date";

/** fix-week's own files: its file in the config folder, and its check, which asserts. */
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

/** The core loop's world once dora has made datekit, pushed it, and opened fix-week. */
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

// --- MCP over HTTP, stateless ------------------------------------------------

const version = "2026-07-28";

const meta = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
  "io.modelcontextprotocol/protocolVersion": version,
};

/** The param the `mcp-name` header repeats, for the methods that route by one. */
const routedBy = new Map([
  ["prompts/get", "name"],
  ["resources/read", "uri"],
  ["tools/call", "name"],
]);

/** One MCP request over the HTTP transport, as `token`'s bearer if given. */
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

/** A JSON-RPC reply: a result, or an error's message. */
const Reply = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
    result: Schema.optionalKey(Schema.Unknown),
  })
);

/** The last JSON-RPC message in a reply, which is plain JSON or an event stream. */
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

/** The result of an MCP call as `token`, decoded with `schema`. */
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

/** The error message of an MCP call that fails, as `token`. */
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

/** A tools/call result: whether it failed, and its one content block's JSON. */
const ToolResult = Schema.Struct({
  content: Schema.Tuple([
    Schema.Struct({
      text: Schema.fromJsonString(Schema.Unknown),
      type: Schema.Literal("text"),
    }),
  ]),
  isError: Schema.Boolean,
});

/** Where an ask's brief is read: `<scheme>ask/<project>/<ask>`. */
const briefUri = (of: ProjectName, ask: AskId) =>
  `${Brand.urlScheme}ask/${of}/${ask}`;

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

// --- Each refusing tool, refused --------------------------------------------

/** A contract's own error union, without the `Unauthenticated` its middleware adds. */
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

/** The tags of the contracts whose own error union is not empty. */
type Refusing<R> = R extends Rpc.Any
  ? [OwnError<R>] extends [never]
    ? never
    : R["_tag"]
  : never;

/** A call a contract refuses in the seeded world, and the refusal it gives. */
interface Provoked<Tag extends string> {
  readonly args: Rpc.Payload<Rpc.ExtractTag<Contract, Tag>>;
  readonly refusal: OwnError<Rpc.ExtractTag<Contract, Tag>>;
}

const base = CommitSha.make("1111111111111111111111111111111111111111");

const head = CommitSha.make("3333333333333333333333333333333333333333");

const requestId = RequestId.make("mcp-refused-0001");

const decision = DecisionId.make("dec-000001");

/**
 * Every contract MCP serves that can refuse, one call it refuses as the
 * operator (who neither made datekit nor claims anything in it), and the
 * refusal it gives.
 */
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
  openAsk: {
    args: { ask: nope, files: askFiles, project },
    refusal: new NotDecider({}),
  },
  proposeAsk: {
    args: { project: nowhere, want },
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
} satisfies {
  readonly [Tag in Refusing<ContractOn<"mcp">>]: Provoked<Tag>;
};

/** The contracts MCP serves whose error union is not empty, in the group's order. */
const refusingOnMcp = [...Contracts.requests.values()].filter(
  (rpc) =>
    Context.get(rpc.annotations, Surfaces).includes("mcp") &&
    !SchemaAST.isNever(rpc.errorSchema.ast)
);

const provokedBy = new Map<
  string,
  { readonly args: unknown; readonly refusal: Refusal }
>(Object.entries(provoked));

// --- The tests ----------------------------------------------------------------

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

          // Before decoding: a call that wrongly succeeded fails here, by
          // this assertion, rather than as a decode error.
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

// --- As the caller --------------------------------------------------------------

const sessions = MemorySessions.layer({
  "alice-token": Handle.make("alice"),
  "bob-token": Handle.make("bob"),
});

/** Who a contract is called as, in a word. */
const callerName = CurrentPrincipal.useSync((principal) =>
  Principal.match(principal, {
    Anonymous: () => "anyone",
    Person: ({ handle }) => handle,
  })
);

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

/**
 * A platform with datekit alone, whose `showAsk` and `listAsks` say who
 * called them: the brief names the caller, and so does the one open ask's
 * want.
 */
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
