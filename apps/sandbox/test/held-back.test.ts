import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { CheckAt } from "@repo/checks/check-runner";
import type { CheckRun, HeldBackPart } from "@repo/checks/check-runner";
import { CheckExit, CheckWire } from "@repo/checks/check-runner/wire";
import { phasePlan } from "@repo/checks/phases";
import type { HeldBackJob } from "@repo/project/visibility-port";
import { Command, Hostname } from "@repo/protocol/domain/common";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  AreaName,
  CommitSha,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
  SuiteRoot,
} from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import {
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Latch,
  Layer,
  Match,
  Option,
  Redacted,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { expectTypeOf } from "vitest";

import { Box, BoxFailed } from "../src/box.ts";
import { checkJob } from "../src/checker.ts";
import { REGISTRIES } from "../src/checker/network.ts";
import { check, REPO, roomFor } from "../src/checker/run.ts";
import { answerJob } from "../src/job.ts";
import { exited, fakeChecker } from "./fake-box.ts";
import type { Call, FakeOptions } from "./fake-box.ts";
import { LocalBox } from "./local-box.ts";

const SETUP = "bun install --frozen-lockfile --ignore-scripts";

const UNIT = "bun test --path-ignore-patterns='test/asks/**'";

const run = RunBlock.make({
  checks: { [LaneName.make("unit")]: Command.make(UNIT) },
  setup: Command.make(SETUP),
  setupEgress: [Hostname.make("npm.pkg.github.com")],
  test: Command.make("bun test {path}"),
});

const suite = SuiteRoot.make(`sha256:${"5e".repeat(32)}`);

const exportArea = AreaName.make("export");

const parser = AreaName.make("parser");

/** Each file carries a canary, so a leak is searchable. */
const SEALED = [
  {
    area: exportArea,
    path: "checks/held-back/export/round-trip.test.ts",
    test: "formats 2026-W53 back to itself",
  },
  {
    area: exportArea,
    path: "checks/held-back/export/iso-weeks.test.ts",
    test: "keeps the ISO year at a year's edge",
  },
  {
    area: parser,
    path: "checks/held-back/parser/week-54.test.ts",
    test: "rejects week 54",
  },
].map(({ area, path, test }) => ({
  area,
  command: `bun test ${path}`,
  path,
  test,
  text: `// canary 7c1e2a90-sealed\ntest(${JSON.stringify(test)}, () => {});\n`,
}));

const weekFile = SEALED.at(-1);

const PARSER_STDOUT = `(fail) parser > ${weekFile?.test}\n`;

const PARSER_STDERR =
  "AssertionError: expected Week(54) to be undefined at week-54.test.ts:3\n";

const heldBack: HeldBackPart = {
  areas: [exportArea, parser],
  at: CommitSha.make("b".repeat(40)),
  files: SEALED.map(({ area, path, text }) => ({
    area,
    content: new TextEncoder().encode(text),
    path: RepoPath.make(path),
  })),
  runs: SEALED.map(({ area, command, path }) => ({
    area,
    command,
    path: RepoPath.make(path),
  })),
  suite,
};

const wireFor = (
  sealed: Option.Option<HeldBackPart> = Option.some(heldBack)
): CheckWire => ({
  clone: {
    token: Redacted.make("art_v1_read-only"),
    url: "https://0123abcd.artifacts.cloudflare.net/git/public/datekit.git",
  },
  job: {
    at: CheckAt.cases.Commit.make({ commit: CommitSha.make("a".repeat(40)) }),
    ...Option.match(sealed, {
      onNone: () => ({}),
      onSome: (part) => ({ heldBack: part }),
    }),
    lanes: [{ command: UNIT, lane: LaneName.make("unit") }],
    placeholders: [],
    project: ProjectName.make("oscabriel/datekit"),
    proxies: [],
    repo: RepoName.make("datekit"),
    run,
  },
});

const parserFails = (options: FakeOptions = {}) =>
  fakeChecker({
    commands: new Map([
      [
        weekFile?.command ?? "",
        exited(1, { stderr: PARSER_STDERR, stdout: PARSER_STDOUT }),
      ],
    ]),
    ...options,
  });

const sealedCommands: ReadonlySet<string> = new Set(
  SEALED.map(({ command }) => command)
);

const writesSealed = (call: Call) =>
  call.kind === "writeFile" ||
  (call.kind === "exec" && call.argv.some((arg) => arg.startsWith(`${REPO}/`)));

const shellOf = (call: Call) =>
  call.kind === "exec" && call.argv[0] === "sh" && call.argv[1] === "-c"
    ? Option.fromUndefinedOr(call.argv[2])
    : Option.none();

const phaseOf = Match.type<Call>().pipe(
  Match.discriminatorsExhaustive("kind")({
    allow: ({ hosts }): readonly string[] =>
      hosts.length === 0 ? ["egressOff"] : ["setup"],
    destroy: () => ["destroy"],
    exec: (call) => {
      if (call.argv[0] === "git") {
        return ["clone"];
      }

      if (writesSealed(call)) {
        return ["writeHeldBack"];
      }

      return Option.match(shellOf(call), {
        onNone: () => ["?"],
        onSome: (command) => {
          if (command === SETUP) {
            return ["setup"];
          }

          return sealedCommands.has(command) ? ["runHeldBack"] : ["run"];
        },
      });
    },
    // The env gateway's routes open as egress goes off.
    intercept: () => ["egressOff"],
    log: () => [],
    report: () => ["report"],
    restore: () => ["setup"],
    route: () => ["clone"],
    save: () => ["snapshot"],
    writeFile: () => ["writeHeldBack"],
  })
);

const phasesOf = (calls: readonly Call[]) =>
  calls
    .flatMap(phaseOf)
    .filter((phase, at, all) => at === 0 || all[at - 1] !== phase);

const SECRETS = [
  ...SEALED.flatMap(({ path, test, text }) => [
    path,
    path.split("/").at(-1) ?? path,
    test,
    text,
  ]),
  "canary 7c1e2a90",
  PARSER_STDOUT.trim(),
  PARSER_STDERR.trim(),
  "Week(54)",
];

const leakedIn = (text: string) =>
  SECRETS.filter((secret) => text.includes(secret));

const leftBy = (calls: readonly Call[]) =>
  JSON.stringify(
    calls.filter((call) => call.kind === "report" || call.kind === "log")
  );

const sealedJob = Effect.gen(function* () {
  const fake = parserFails();

  const outcome = yield* Effect.exit(
    check(wireFor()).pipe(Effect.provide(fake.layer))
  );

  return { calls: fake.calls, outcome };
});

/** What a public lane prints when it finds the sealed files too (`bun test` with no path). */
const printedBeside = exited(1, {
  stdout: `(fail) export > ${SEALED[0]?.test}\nAssertionError: expected 53 to be 52\n`,
});

const LINT_COUNT = "oxlint --format json";

const printing = () =>
  fakeChecker({
    commands: new Map([
      [UNIT, printedBeside],
      [LINT_COUNT, printedBeside],
    ]),
  });

const withCountLane = (sealed: Option.Option<HeldBackPart>): CheckWire => {
  const base = wireFor(sealed);

  return {
    ...base,
    job: {
      ...base.job,
      lanes: [
        ...base.job.lanes,
        {
          command: LINT_COUNT,
          lane: LaneName.make("lint-count"),
          output: "stdout",
        },
      ],
    },
  };
};

const serialized = (outcome: Exit.Exit<CheckRun, VerifierBlocked>) =>
  Schema.encodeEffect(CheckExit)(outcome).pipe(
    Effect.map((encoded) => JSON.stringify(encoded))
  );

describe("the Checker's held-back phase", () => {
  it.effect(
    "writes the sealed files only after the snapshot and with egress off, runs the public lanes, then each sealed check, and destroys the container, in the plan's order",
    () =>
      Effect.gen(function* () {
        const { calls, outcome } = yield* sealedJob;

        expect(Exit.isSuccess(outcome)).toBeTruthy();
        expect(phasesOf(calls)).toStrictEqual([
          "clone",
          "setup",
          "snapshot",
          "egressOff",
          "writeHeldBack",
          "run",
          "runHeldBack",
          "report",
          "destroy",
        ]);

        expect(
          phasesOf(calls)
            .slice(1, -1)
            .filter((phase) => phase !== "runHeldBack")
        ).toStrictEqual(
          phasePlan({
            heldBack: Option.some({ areas: heldBack.areas }),
            lanes: [{ command: UNIT, lane: LaneName.make("unit") }],
            lockfileHash: "any",
            placeholders: [],
            run,
          }).map(
            ({ _tag }) => `${_tag.charAt(0).toLowerCase()}${_tag.slice(1)}`
          )
        );

        expect(
          calls.find(
            (call) =>
              call.kind === "exec" && Option.contains(shellOf(call), SETUP)
          )
        ).toMatchObject({ network: [...REGISTRIES, "npm.pkg.github.com"] });
        expect(calls.at(-1)).toStrictEqual({ kind: "destroy" });
      })
  );

  it.effect(
    "writes each sealed file's bytes at its path in the checked tree, and takes or restores no snapshot after the first",
    () =>
      Effect.gen(function* () {
        const { calls } = yield* sealedJob;
        const firstWrite = calls.findIndex((call) => call.kind === "writeFile");

        expect(
          calls.flatMap((call) =>
            call.kind === "writeFile"
              ? [{ path: call.path, text: call.text }]
              : []
          )
        ).toStrictEqual(
          SEALED.map(({ path, text }) => ({ path: `${REPO}/${path}`, text }))
        );
        expect(firstWrite).toBeGreaterThan(-1);
        expect(
          calls
            .slice(firstWrite)
            .filter((call) => call.kind === "save" || call.kind === "restore")
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "runs each sealed check once, in the job's order, with the network off",
    () =>
      Effect.gen(function* () {
        const { calls } = yield* sealedJob;

        expect(
          calls.flatMap((call) =>
            Option.match(shellOf(call), {
              onNone: () => [],
              onSome: (command) =>
                sealedCommands.has(command) && call.kind === "exec"
                  ? [{ command, network: call.network }]
                  : [],
            })
          )
        ).toStrictEqual(
          SEALED.map(({ command }) => ({ command, network: [] }))
        );
      })
  );

  it.effect(
    "reports one result per area, passed of total under the suite root, with the parser's check failing",
    () =>
      Effect.gen(function* () {
        const fake = parserFails();

        const ran = yield* check(wireFor()).pipe(Effect.provide(fake.layer));

        expect(ran.heldBack).toStrictEqual([
          { area: "export", passed: 2, suite, total: 2 },
          { area: "parser", passed: 0, suite, total: 1 },
        ]);
        expect(
          ran.lanes.map(({ lane, result }) => ({ lane, result }))
        ).toStrictEqual([{ lane: "unit", result: "passed" }]);
      })
  );

  it.effect(
    "lets no sealed path, file content, test name or sealed check's output into the result, the logs it hands over or its log lines",
    () =>
      Effect.gen(function* () {
        const fake = parserFails();

        const outcome = yield* Effect.exit(
          check(wireFor()).pipe(Effect.provide(fake.layer))
        );

        const result = yield* serialized(outcome);

        expect(result).toContain(suite);
        expect(leakedIn(result)).toStrictEqual([]);
        expect(leakedIn(leftBy(fake.calls))).toStrictEqual([]);
      })
  );

  it.effect(
    "without a sealed suite, keeps a failing public lane's log and signature, and a count lane's output",
    () =>
      Effect.gen(function* () {
        const fake = printing();

        const ran = yield* check(withCountLane(Option.none())).pipe(
          Effect.provide(fake.layer)
        );

        expect(ran.evidence[0]?.signature).toContain(SEALED[0]?.test);
        expect(ran.outputs).toHaveLength(1);
        expect(leakedIn(leftBy(fake.calls))).not.toStrictEqual([]);
      })
  );

  it.effect(
    "keeps nothing a public lane printed once the sealed files sit in its tree: no log, no failure signature, no count output",
    () =>
      Effect.gen(function* () {
        const fake = printing();

        const ran = yield* check(withCountLane(Option.some(heldBack))).pipe(
          Effect.provide(fake.layer)
        );

        expect(
          ran.lanes.map(({ lane, result }) => ({ lane, result }))
        ).toStrictEqual([
          { lane: "unit", result: "failed" },
          { lane: "lint-count", result: "failed" },
        ]);
        expect(ran.evidence).toStrictEqual([
          { lane: "unit" },
          { lane: "lint-count" },
        ]);
        expect(ran).not.toHaveProperty("outputs");
        expect(leakedIn(JSON.stringify(ran))).toStrictEqual([]);
        expect(leakedIn(leftBy(fake.calls))).toStrictEqual([]);
      })
  );

  it.effect(
    "makes no held-back write for a job without a sealed suite, and reports no areas",
    () =>
      Effect.gen(function* () {
        const fake = parserFails();

        const ran = yield* check(wireFor(Option.none())).pipe(
          Effect.provide(fake.layer)
        );

        expect(ran.heldBack).toStrictEqual([]);
        expect(fake.calls.filter(writesSealed)).toStrictEqual([]);
        expect(phasesOf(fake.calls)).toStrictEqual([
          "clone",
          "setup",
          "snapshot",
          "egressOff",
          "run",
          "report",
          "destroy",
        ]);
      })
  );

  it.effect(
    "counts a sealed check that runs out of time, or whose container fails it, as not passed, and says no more",
    () =>
      Effect.gen(function* () {
        const started = yield* Latch.make();
        const [roundTrip] = SEALED;

        const fake = fakeChecker({
          commands: new Map([
            // It says when it started, so the clock moves only once its
            // limit is running.
            [
              roundTrip?.command ?? "",
              started.open.pipe(Effect.andThen(Effect.never)),
            ],
            [
              weekFile?.command ?? "",
              Effect.fail(
                new BoxFailed({
                  operation: "exec",
                  reason: `process for ${weekFile?.command} died`,
                })
              ),
            ],
          ]),
        });

        const fiber = yield* check(wireFor()).pipe(
          Effect.provide(fake.layer),
          Effect.forkChild
        );

        yield* started.await;
        yield* TestClock.adjust(Duration.minutes(10));

        const outcome = yield* Effect.exit(Fiber.join(fiber));

        expect(Exit.map(outcome, ({ heldBack: areas }) => areas)).toStrictEqual(
          Exit.succeed([
            { area: "export", passed: 1, suite, total: 2 },
            { area: "parser", passed: 0, suite, total: 1 },
          ])
        );
        expect(leakedIn(leftBy(fake.calls))).toStrictEqual([]);
      })
  );

  it.effect(
    "is VerifierBlocked, naming no path, when a sealed file cannot be written, and runs nothing after",
    () =>
      Effect.gen(function* () {
        const fake = parserFails({
          writeFile: (path) =>
            path.endsWith("iso-weeks.test.ts")
              ? Effect.fail(
                  new BoxFailed({
                    operation: "writeFile",
                    reason: `ENOSPC writing ${path}`,
                  })
                )
              : Effect.void,
        });

        const outcome = yield* Effect.exit(
          check(wireFor()).pipe(Effect.provide(fake.layer))
        );

        expect(Exit.findErrorOption(outcome)).toStrictEqual(
          Option.some(new VerifierBlocked({}))
        );
        expect(phasesOf(fake.calls)).toStrictEqual([
          "clone",
          "setup",
          "snapshot",
          "egressOff",
          "writeHeldBack",
          "report",
          "destroy",
        ]);
        expect(leakedIn(leftBy(fake.calls))).toStrictEqual([]);
      })
  );

  it.effect(
    "is VerifierBlocked, writing nothing and naming no path, for a sealed file whose path leaves the checked tree",
    () =>
      Effect.gen(function* () {
        const outside = [
          "../escape.test.ts",
          "/etc/profile.d/escape.sh",
          "a/./b.ts",
          "a//b.ts",
        ];

        const blocked = yield* Effect.forEach(outside, (path) =>
          Effect.gen(function* () {
            const fake = fakeChecker();

            const wire = wireFor(
              Option.some({
                ...heldBack,
                files: [
                  ...heldBack.files,
                  {
                    area: parser,
                    content: new TextEncoder().encode("test('x', () => {});"),
                    path: RepoPath.make(path),
                  },
                ],
              })
            );

            const outcome = yield* Effect.exit(
              check(wire).pipe(Effect.provide(fake.layer))
            );

            return {
              error: Exit.findErrorOption(outcome),
              named: leftBy(fake.calls).includes(path),
              written: fake.calls.filter(writesSealed).length,
            };
          })
        );

        expect(blocked).toStrictEqual(
          outside.map(() => ({
            error: Option.some(new VerifierBlocked({})),
            named: false,
            written: 0,
          }))
        );
      })
  );

  it.live(
    "makes room for each sealed file whatever the answer's tree holds where it goes, and keeps the tree's other files",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const box = yield* Box;
        const tree = yield* fs.makeTempDirectoryScoped({ prefix: "tree-" });

        const outside = yield* fs.makeTempDirectoryScoped({
          prefix: "outside-",
        });

        const sealed = [
          "checks/held-back/export/round-trip.test.ts",
          "checks/held-back/parser/week-54.test.ts",
          "checks/held-back/tz/zone.test.ts",
        ];

        // The answer's tree: a file where one sealed folder goes, a link to
        // a folder outside the tree where another goes, and a folder where
        // a sealed file goes, beside a file of its own. Left there, each
        // fails the write, and the refusal would tell the answer that a
        // sealed path is there without spending an attempt.
        yield* fs.makeDirectory(`${tree}/checks/held-back/tz/zone.test.ts`, {
          recursive: true,
        });
        yield* fs.writeFileString(`${tree}/checks/held-back/export`, "x\n");
        yield* fs.symlink(outside, `${tree}/checks/held-back/parser`);
        yield* fs.writeFileString(`${tree}/checks/own.test.ts`, "own\n");

        const made = yield* box.exec(roomFor(tree, sealed), {
          cwd: tree,
          env: { PATH: "/usr/bin:/bin" },
        });

        expect(made.exitCode).toBe(0);

        yield* Effect.forEach(sealed, (path) =>
          box.writeFile(
            `${tree}/${path}`,
            new TextEncoder().encode(`sealed ${path}\n`)
          )
        );

        expect(
          yield* Effect.forEach(sealed, (path) =>
            fs.readFileString(`${tree}/${path}`)
          )
        ).toStrictEqual(sealed.map((path) => `sealed ${path}\n`));
        expect(yield* fs.readFileString(`${tree}/checks/own.test.ts`)).toBe(
          "own\n"
        );
        expect(yield* fs.readDirectory(outside)).toStrictEqual([]);
      }).pipe(
        Effect.scoped,
        Effect.provide(Layer.merge(LocalBox, NodeServices.layer))
      )
  );

  it("takes the held-back job the platform reads from the layer as it is", () => {
    expectTypeOf<HeldBackJob>().toEqualTypeOf<HeldBackPart>();
  });

  it.effect(
    "takes the sealed files as base64 on the wire and writes the bytes they encode",
    () =>
      Effect.gen(function* () {
        const fake = parserFails();
        const encoded = yield* Schema.encodeEffect(CheckWire)(wireFor());

        expect(encoded.job.heldBack?.files[0]).toStrictEqual({
          area: "export",
          contentBase64: btoa(SEALED[0]?.text ?? ""),
          path: SEALED[0]?.path,
        });

        const outcome = yield* Effect.promise(() =>
          answerJob(checkJob, (decoded) =>
            check(decoded).pipe(Effect.provide(fake.layer))
          )(encoded)
        ).pipe(Effect.flatMap(Schema.decodeEffect(CheckExit)));

        expect(
          Exit.map(outcome, ({ heldBack: areas }) =>
            areas.map(({ passed }) => passed)
          )
        ).toStrictEqual(Exit.succeed([2, 0]));
        expect(
          fake.calls.flatMap((call) =>
            call.kind === "writeFile" ? [call.text] : []
          )
        ).toStrictEqual(SEALED.map(({ text }) => text));
      })
  );
});
