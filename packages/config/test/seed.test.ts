/**
 * The seed (issue 509): what it plans to put on a platform for each example
 * project, read from the example's tracked files, and putting it there.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Layer, Path } from "effect";

import { Brand } from "../../../scripts/lib/gen.ts";
import {
  planSeed,
  ready,
  runSeed,
  seeded,
  stageTarget,
  worldTarget,
} from "../../../scripts/lib/seed.ts";
import type { SeedStep } from "../../../scripts/lib/seed.ts";
import { optionsOf, SeedWhere } from "../../../scripts/seed.ts";
import { repoRoot } from "./root.ts";

/** The config folder's name, from the brand (`Brand.configDir`). */
const config = Brand.configDir;

/** A file of an example, as the test reads it from disk. */
const onDisk = (example: string, path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const root = yield* repoRoot;

    return yield* fs.readFileString(paths.join(root, example, path));
  });

describe(planSeed, () => {
  it.effect(
    "plans datekit as the library before anyone asked: every tracked file but the asks and their checks, then each ask with its check, opened by ines-v",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/datekit");

        expect({
          decider: plan.decider,
          project: plan.project,
          ratchets: plan.ratchets,
        }).toStrictEqual({
          decider: "ines-v",
          project: "datekit",
          ratchets: [],
        });

        expect(plan.initFiles.map(({ path }) => path)).toStrictEqual([
          ".env.schema",
          ".env.test",
          ".gitignore",
          `${config}/project.ts`,
          `${config}/vouched.td`,
          "LICENSE",
          "README.md",
          "package.json",
          "src/add.ts",
          "src/calendar.ts",
          "src/diff.ts",
          "src/format.ts",
          "src/index.ts",
          "src/parse.ts",
          "src/tz.ts",
          "test/add.test.ts",
          "test/diff.test.ts",
          "test/format.test.ts",
          "test/parse.test.ts",
          "tsconfig.json",
        ]);

        expect(
          plan.asks.map(({ files, id, kind }) => ({
            files: files.map(({ path }) => path),
            id,
            kind,
          }))
        ).toStrictEqual([
          {
            files: [
              `${config}/asks/add-months-clamp.ask.ts`,
              "test/asks/add-months-clamp.test.ts",
            ],
            id: "add-months-clamp",
            kind: "fix",
          },
          {
            files: [
              `${config}/asks/format-ordinal.ask.ts`,
              "test/asks/format-ordinal.test.ts",
            ],
            id: "format-ordinal",
            kind: "fix",
          },
          {
            files: [
              `${config}/asks/parse-iso-week.ask.ts`,
              "test/asks/parse-iso-week.test.ts",
            ],
            id: "parse-iso-week",
            kind: "fix",
          },
        ]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "plans burrow with its ratchet in main's config and one migrate ask, which names no check file, opened by okafor",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/burrow");

        expect({
          decider: plan.decider,
          project: plan.project,
          ratchets: plan.ratchets,
        }).toStrictEqual({
          decider: "okafor",
          project: "burrow",
          ratchets: ["no-module-level-mutable-state"],
        });

        expect(
          plan.asks.map(({ files, id, kind }) => ({
            files: files.map(({ path }) => path),
            id,
            kind,
          }))
        ).toStrictEqual([
          {
            files: [`${config}/asks/drop-legacy-fetch.ask.ts`],
            id: "drop-legacy-fetch",
            kind: "migrate",
          },
        ]);

        const paths = plan.initFiles.map(({ path }) => path);

        expect(paths).toHaveLength(50);

        expect(paths).toStrictEqual(
          expect.arrayContaining([
            `${config}/project.ts`,
            "bun.lock",
            "packages/kit/src/legacy.ts",
            "scripts/count-callers.ts",
          ])
        );

        expect(
          paths.filter((path) => path.startsWith(`${config}/asks/`))
        ).toStrictEqual([]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "carries each file as it is on disk: the library's files as bytes, an ask's files as text",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/datekit");

        const add = plan.initFiles.find(({ path }) => path === "src/add.ts");

        expect(new TextDecoder().decode(add?.content)).toBe(
          yield* onDisk("examples/datekit", "src/add.ts")
        );

        expect(plan.asks[1]?.files[1]?.content).toBe(
          yield* onDisk("examples/datekit", "test/asks/format-ordinal.test.ts")
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

/** Each step's tag and target, with what this run did of it. */
const linesOf = (steps: readonly SeedStep[]) =>
  steps.map(({ _tag, result, target }) => `${_tag} ${target}: ${result}`);

describe(runSeed, () => {
  it.live(
    "puts both examples on the Node world, each ask red first on the world's own Checker, and a second run finds every step done and changes nothing",
    () =>
      Effect.gen(function* () {
        const plans = [
          yield* planSeed("examples/datekit"),
          yield* planSeed("examples/burrow"),
        ];

        const seed = Effect.forEach(plans, runSeed);

        const story = Effect.gen(function* () {
          const first = yield* seed;

          expect(first.flatMap(linesOf)).toStrictEqual([
            "Init datekit: done",
            "Push datekit: done",
            "OpenAsk datekit/add-months-clamp: done",
            "OpenAsk datekit/format-ordinal: done",
            "OpenAsk datekit/parse-iso-week: done",
            "Init burrow: done",
            "Push burrow: done",
            "OpenAsk burrow/drop-legacy-fetch: done",
          ]);

          const held = yield* seeded(plans);

          // Each project's asks, each with the asks it waits on.
          const asks = Object.fromEntries(
            held.map(({ asks: listed, project }) => [
              project,
              Object.fromEntries(
                listed.map(({ ask, blockedBy }) => [
                  ask,
                  blockedBy.map(String).toSorted(),
                ])
              ),
            ])
          );

          const children = [
            "drop-legacy-fetch-burrow-auth",
            "drop-legacy-fetch-burrow-billing",
            "drop-legacy-fetch-burrow-catalog",
            "drop-legacy-fetch-burrow-kit",
            "drop-legacy-fetch-burrow-notify",
            "drop-legacy-fetch-burrow-search",
          ];

          expect(asks).toStrictEqual({
            burrow: {
              "drop-legacy-fetch": [...children, "drop-legacy-fetch-delete"],
              "drop-legacy-fetch-delete": children,
              ...Object.fromEntries(children.map((child) => [child, []])),
            },
            datekit: {
              "add-months-clamp": [],
              "format-ordinal": [],
              "parse-iso-week": [],
            },
          });

          const again = yield* seed;

          expect(again.flatMap(linesOf)).toStrictEqual(
            first
              .flatMap(linesOf)
              .map((line) => line.replace(/: done$/u, ": already"))
          );

          expect(yield* seeded(plans)).toStrictEqual(held);
        });

        yield* story.pipe(
          Effect.provide(
            worldTarget(plans.map(({ decider }) => decider)).pipe(
              Layer.provide(NodeServices.layer)
            )
          )
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );
});

describe("runSeed, when a person has no session", () => {
  it.live(
    "stops before its first step, naming the decider the platform has no session for",
    () =>
      Effect.gen(function* () {
        const plan = yield* planSeed("examples/burrow");

        const failure = yield* runSeed(plan).pipe(
          Effect.flip,
          Effect.provide(
            worldTarget([]).pipe(Layer.provide(NodeServices.layer))
          )
        );

        expect(failure.reason).toContain("no session for okafor");
        expect(failure.reason).toContain("then run the seed again");
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});

describe(ready, () => {
  it.live(
    "names every person the platform has no session for, before anything is seeded",
    () =>
      Effect.gen(function* () {
        const plans = [
          yield* planSeed("examples/datekit"),
          yield* planSeed("examples/burrow"),
        ];

        const failure = yield* Effect.flip(ready(plans)).pipe(
          Effect.provide(
            worldTarget([]).pipe(Layer.provide(NodeServices.layer))
          )
        );

        expect(failure.reason).toContain("no session for ines-v, okafor");
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});

describe(stageTarget, () => {
  const secret = "a-token-nobody-may-see-0123456789abcdef";

  it.effect.each([
    [
      "the sessions are not JSON",
      { OPERATOR_TOKEN: secret, SESSION_TOKENS: secret },
    ],
    [
      "the operator's token is missing",
      { SESSION_TOKENS: JSON.stringify({ [secret]: "ines-v" }) },
    ],
  ] as const)(
    "says what is wrong when %s, and never what a token is",
    ([, env]) =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          Layer.build(
            stageTarget("http://127.0.0.1:9", {
              operator: "OPERATOR_TOKEN",
              sessions: "SESSION_TOKENS",
            })
          )
        ).pipe(Effect.scoped);

        expect(failure.reason).not.toContain(secret);
        expect(failure.reason).toMatch(/OPERATOR_TOKEN|SESSION_TOKENS/u);
      }).pipe(
        Effect.provide(
          Layer.merge(
            NodeServices.layer,
            ConfigProvider.layer(ConfigProvider.fromUnknown(env))
          )
        )
      )
  );
});

describe(optionsOf, () => {
  it.effect.each([
    [["--world", "node"], "World"],
    [["--stage", "dev-oscabriel"], "Stage"],
    [["--stage", "demo", "--yes"], "Stage"],
  ] as const)("takes %j as a seed of the %s", ([argv, where]) =>
    Effect.map(optionsOf(argv), (options) => {
      expect(options.where._tag).toBe(where);
    })
  );

  it.effect.each([
    [["--stage", "demo"], "--yes"],
    [[], "--world node or --stage"],
    [["--world", "node", "--stage", "dev-oscabriel"], "only one"],
    [["--world", "workerd"], "--world node"],
    [["--stage", "prod"], "prod"],
    [["--world", "node", "--force"], "--force"],
  ] as const)("refuses %j, saying %s", ([argv, said]) =>
    Effect.map(Effect.flip(optionsOf(argv)), (failure) => {
      expect(failure.reason).toContain(said);
    })
  );

  it.effect(
    "reads which env vars hold the stage's tokens, and which project alone to seed",
    () =>
      Effect.map(
        optionsOf([
          "--stage",
          "dev-oscabriel",
          "--tokens-env",
          "DEMO_SESSIONS",
          "--operator-env=DEMO_OPERATOR",
          "--only",
          "burrow",
          "--json",
        ]),
        (options) => {
          expect(options).toStrictEqual({
            json: true,
            only: "burrow",
            where: SeedWhere.cases.Stage.make({
              stage: "dev-oscabriel",
              tokens: { operator: "DEMO_OPERATOR", sessions: "DEMO_SESSIONS" },
            }),
          });
        }
      )
  );
});
