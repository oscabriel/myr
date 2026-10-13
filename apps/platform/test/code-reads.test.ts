import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { AskId, Handle, RepoName, RepoPath } from "@repo/protocol/ids";
import { UnknownRevision } from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Effect, Layer, SchemaAST } from "effect";

import { Handlers } from "../src/handlers.ts";
import { MemorySessions } from "../src/sessions/memory.ts";
import { seeded, worldOf } from "./handlers.fixtures.ts";
import { origin, rpcClient, served } from "./harness.ts";

const datekit = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = datekit;

const BOB = "bob-session";

const platform = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const world = yield* Layer.build(worldOf([datekit]));

  yield* seeded(datekit).pipe(Effect.provide(world));

  const ports = Layer.succeedContext(world);

  return yield* served(
    Layer.mergeAll(
      Handlers.pipe(Layer.provide(ports)),
      ports,
      MemorySessions.layer({ [BOB]: Handle.make("bob") })
    )
  );
});

const codeReads = [
  "listRefs",
  "readTree",
  "listPaths",
  "readFile",
  "log",
  "showCommit",
  "why",
];

const fieldsIn = (
  ast: SchemaAST.AST
): readonly (readonly [string, SchemaAST.AST])[] => {
  if (SchemaAST.isObjects(ast)) {
    return ast.propertySignatures.flatMap(({ name, type }) => [
      [String(name), type] as const,
      ...fieldsIn(type),
    ]);
  }

  return SchemaAST.isUnion(ast) ? ast.types.flatMap(fieldsIn) : [];
};

describe("the code reads over /rpc", () => {
  it.effect(
    "answer anyone with datekit's refs, its root folder and a file",
    () =>
      Effect.gen(function* () {
        const { handler } = yield* platform;
        const anyone = yield* rpcClient(handler);
        const refs = yield* anyone.listRefs({ project });
        const root = yield* anyone.readTree({ project });

        const file = yield* anyone.readFile({
          path: RepoPath.make("package.json"),
          project,
        });

        expect([refs.project, refs.tags]).toStrictEqual([project, []]);
        expect(root.at).toBe(refs.landed);
        expect(root.entries.map(({ name }) => name)).toStrictEqual(
          expect.arrayContaining(["packages", "package.json"])
        );
        expect(file.text).toContain('"name": "datekit"');
      })
  );

  it.effect("answer anyone with datekit's paths, log and first commit", () =>
    Effect.gen(function* () {
      const { handler } = yield* platform;
      const anyone = yield* rpcClient(handler);
      const { landed } = yield* anyone.listRefs({ project });
      const { commits } = yield* anyone.log({ project });
      const first = commits.at(-1)?.sha ?? "main";
      const paths = yield* anyone.listPaths({ at: first, project });

      expect([commits[0]?.sha, commits.at(-1)?.subject]).toStrictEqual([
        landed,
        "Start",
      ]);
      expect(paths.paths).toContain("packages/parser/src/parse.ts");

      const diff = yield* anyone.showCommit({ project, sha: paths.at });

      expect(
        diff.files.map(({ path, status }) => [path, status])
      ).toStrictEqual(paths.paths.map((path) => [path, "added"]));
    })
  );

  it.effect(
    "read the canonical repo whatever extra key a payload carries",
    () =>
      Effect.gen(function* () {
        const { handler } = yield* platform;

        const payload = JSON.stringify({
          project,
          repo: "alice__datekit--me--alice",
        });

        const response = yield* Effect.promise(() =>
          handler(
            new Request(`${origin}/rpc`, {
              body: `{"_tag":"Request","id":"1","tag":"readTree","payload":${payload},"headers":[]}`,
              headers: { "content-type": "application/json" },
              method: "POST",
            })
          )
        );

        const text = yield* Effect.promise(() => response.text());
        const anyone = yield* rpcClient(handler);
        const canonical = yield* anyone.readTree({ project });

        expect(response.status).toBe(200);
        expect(text).not.toContain("alice__datekit--me--alice");
        expect(text).toContain(canonical.at);
      })
  );

  it.effect(
    "read bob's claim fork at its address, and no repo the project does not list as its fork",
    () =>
      Effect.gen(function* () {
        const { handler } = yield* platform;
        const anyone = yield* rpcClient(handler);
        const bob = yield* rpcClient(handler, BOB);

        yield* bob.claim({ ask: AskId.make("parse-iso"), project });

        const { landed } = yield* anyone.listRefs({ project });
        const tree = yield* anyone.readTree({ at: "@bob/parse-iso", project });

        const { commit } = yield* anyone.showCommit({
          at: "@bob/parse-iso",
          project,
          sha: tree.at,
        });

        const refused = ["@carol/parse-iso", "alice__datekit--parse-iso--bob"];

        expect([tree.at, commit.sha]).toStrictEqual([landed, landed]);
        expect(
          yield* Effect.forEach(refused, (at) =>
            Effect.flip(anyone.readTree({ at, project }))
          )
        ).toStrictEqual(refused.map((rev) => new UnknownRevision({ rev })));
      })
  );

  it("name no repo in any code read's payload", () => {
    const rpcs = codeReads.map(
      (tag) => [tag, Contracts.requests.get(tag)] as const
    );

    const fields = rpcs.flatMap(([tag, rpc]) =>
      rpc === undefined
        ? []
        : fieldsIn(rpc.payloadSchema.ast).map(
            ([name, type]) => [tag, name, type] as const
          )
    );

    expect(
      rpcs.flatMap(([tag, rpc]) => (rpc === undefined ? [tag] : []))
    ).toStrictEqual([]);
    expect(
      fields.some(
        ([tag, name, type]) =>
          tag === "readFile" && name === "path" && type === RepoPath.ast
      )
    ).toBeTruthy();
    expect(
      fields.flatMap(([tag, name, type]) =>
        type === RepoName.ast || name === "repo" ? [`${tag}.${name}`] : []
      )
    ).toStrictEqual([]);
  });
});
