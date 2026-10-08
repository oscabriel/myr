/**
 * The seed (issue 509): what it plans to put on a platform for each example
 * project, read from the example's tracked files, and putting it there.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";

import {
  planSeed,
  ready,
  runSeed,
  seeded,
  SeedTarget,
  stageTarget,
  worldTarget,
} from "../../../scripts/lib/seed.ts";
import type { SeedStep } from "../../../scripts/lib/seed.ts";
import {
  main,
  optionsOf,
  SeedEnvelope,
  SeedWhere,
  stepLine,
} from "../../../scripts/seed.ts";
import { Brand } from "../../brand/src/index.ts";
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
    "plans datekit as the library before anyone asked: every tracked file but the asks, their checks and its layer, then each ask with its check, opened by ines-v",
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
          `${config}/visibility.ts`,
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

/** Each step as the command prints it. */
const linesOf = (steps: readonly SeedStep[]) => steps.map(stepLine);

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
            "Layer datekit--maintainers: done",
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

        const { failure, refs } = yield* Effect.gen(function* () {
          const stopped = yield* Effect.flip(runSeed(plan));
          const target = yield* SeedTarget;

          // No project was made: the gateway has no burrow to list refs of.
          const listed = yield* target.refsOf(plan.project).pipe(
            Effect.map((held) => `listed ${held.size} refs`),
            Effect.catch(({ reason }) => Effect.succeed(reason))
          );

          return { failure: stopped, refs: listed };
        }).pipe(
          Effect.provide(
            worldTarget([]).pipe(Layer.provide(NodeServices.layer))
          )
        );

        expect(failure.reason).toContain("no session for okafor");
        expect(failure.reason).toContain("then run the seed again");
        expect(refs).toContain("no repo burrow");
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
    [
      "the stage doesn't answer the operator's status",
      {
        OPERATOR_TOKEN: secret,
        SESSION_TOKENS: JSON.stringify({ [`${secret}-ines`]: "ines-v" }),
      },
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

/** What `main` prints, line by line, and how it ended. */
const printedBy = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    yield* main(argv).pipe(Effect.provideService(Console.Console, captured));

    return printed;
  }).pipe(Effect.provide(NodeServices.layer));

describe(main, () => {
  it.live(
    "prints one line per step, one per project and a summary",
    () =>
      Effect.gen(function* () {
        const printed = yield* printedBy([
          "--world",
          "node",
          "--only",
          "datekit",
        ]);

        expect(printed.slice(0, 7)).toStrictEqual([
          "seed: datekit on the Node world",
          "Init datekit: done",
          "Push datekit: done",
          "OpenAsk datekit/add-months-clamp: done",
          "OpenAsk datekit/format-ordinal: done",
          "OpenAsk datekit/parse-iso-week: done",
          "Layer datekit--maintainers: done",
        ]);

        expect(printed[7]).toMatch(
          /^datekit: main at [\da-f]{12}, 3 open asks, decided by ines-v$/u
        );

        expect(printed.slice(8)).toStrictEqual([
          "seeded 1 project on the Node world: 6 steps, 6 done, 0 already",
        ]);
      }),
    60_000
  );

  it.live(
    "prints only the versioned envelope with --json: each step, and what each project holds",
    () =>
      Effect.gen(function* () {
        const printed = yield* printedBy([
          "--world",
          "node",
          "--only",
          "burrow",
          "--json",
        ]);

        expect(printed).toHaveLength(1);

        const envelope = yield* Schema.decodeEffect(
          Schema.fromJsonString(SeedEnvelope)
        )(printed.join("\n"));

        expect({
          command: envelope.command,
          ok: envelope.ok,
          v: envelope.v,
        }).toStrictEqual({ command: "seed", ok: true, v: 1 });

        const data = envelope.ok ? envelope.data : undefined;

        expect(data?.steps.map(stepLine)).toStrictEqual([
          "Init burrow: done",
          "Push burrow: done",
          "OpenAsk burrow/drop-legacy-fetch: done",
        ]);

        const [held] = data?.projects ?? [];

        expect({
          asks: held?.asks.length,
          decider: held?.decider,
          project: held?.project,
          ratchets: held?.ratchets,
        }).toStrictEqual({
          // The migrate ask's family: the parent, six children, the delete child.
          asks: 8,
          decider: "okafor",
          project: "burrow",
          ratchets: ["no-module-level-mutable-state"],
        });

        expect(held?.main).toMatch(/^[\da-f]{40}$/u);
      }),
    60_000
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
