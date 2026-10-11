/**
 * The code reads over `/rpc`, as anyone not signed in calls them: datekit's
 * refs, a folder, a file, the log and a commit's changes, read from its
 * canonical repo only. No code read's payload names a repo, so a caller
 * cannot point one at a fork: an extra `repo` key is dropped or refused,
 * and the canonical repo is read either way.
 */
import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { RepoName, RepoPath } from "@repo/protocol/ids";
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

/** The platform over datekit's world, seeded: made, pushed to, its ask open. */
const platform = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const world = yield* Layer.build(worldOf([datekit]));

  yield* seeded(datekit).pipe(Effect.provide(world));

  const ports = Layer.succeedContext(world);

  return yield* served(
    Layer.mergeAll(
      Handlers.pipe(Layer.provide(ports)),
      ports,
      MemorySessions.layer({})
    )
  );
});

/** The contracts that read a project's code. */
const codeReads = [
  "listRefs",
  "readTree",
  "listPaths",
  "readFile",
  "log",
  "showCommit",
  "why",
];

/** Every field of a payload, nested ones included: its name and its type's AST. */
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

        // The wire's request, written as a client would send it, with a
        // `repo` beside the project that no contract has.
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
    // The check sees a branded field: `readFile`'s path is a `RepoPath`.
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
