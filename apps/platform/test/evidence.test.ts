/**
 * A failing lane's log, kept and read through the platform: the
 * Answer Workflow keeps the log of alice's failing `unit` lane in the
 * stage's evidence bucket (an R2 fake here, through `EvidenceStoreR2`, as
 * the Worker composes it), her refusal names only where it is kept, and
 * `evidence` over `/rpc` gives it to her and to dora, the project's
 * decider, and to nobody else. The world is the core loop's (`world.ts`):
 * the platform's own fetch handler with real git.
 */
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { EvidenceStore } from "@repo/checks/evidence-store";
import { EvidenceStoreR2 } from "@repo/checks/evidence-store/r2";
import type { EvidenceBucket } from "@repo/checks/evidence-store/r2";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  Handle,
  LaneName,
  ProjectName,
  RepoPath,
  RequestId,
  keyOf,
  TreeSha,
} from "@repo/protocol/ids";
import { Unauthenticated } from "@repo/protocol/principal";
import {
  ChecksFailed,
  NotDecider,
  UnknownProject,
} from "@repo/protocol/refusal";
import { Array, Cause, Effect, Exit, Stream } from "effect";

import { decodeEnv } from "../src/platform.ts";
import { workerPorts } from "../src/ports.ts";
import { fakeEnv } from "./fake-env.ts";
import { coreLoopWorld } from "./world.ts";
import type { Someone } from "./world.ts";

const project = ProjectName.make("dora/datekit");

const parseIso = AskId.make("parse-iso");

const redThenGreen = LaneName.make("redThenGreen");

const unit = LaneName.make("unit");

const sdk = `${Brand.cliPackage}/rules`;

/** The project as dora first pushes it: its run block has a `unit` lane. */
const start = {
  [`${Brand.configDir}/project.ts`]: [
    `import { kinds, project } from "${sdk}";`,
    ``,
    `export default project({`,
    `  kinds: [kinds.fix],`,
    `  run: { checks: { unit: "bun test" }, test: "bun test {path}" },`,
    `});`,
    ``,
  ].join("\n"),
  [`${Brand.configDir}/vouched.td`]: "alice\nbob\n",
  "README.md": "datekit: dates, parsed\n",
  "package.json": '{ "name": "dora/datekit", "private": true }\n',
  "src/parse.ts":
    "export const parse = (iso: string) => ({ month: 0, year: 0 });\n",
};

const askFiles = Array.make(
  {
    content: [
      `import { kinds, territory } from "${sdk}";`,
      ``,
      `export default kinds.fix.ask({`,
      `  path: "test/${parseIso}.test.ts",`,
      `  territory: territory.paths("src/parse.ts"),`,
      `  want: "parse reads the year of an ISO date",`,
      `});`,
      ``,
    ].join("\n"),
    path: RepoPath.make(`${Brand.configDir}/asks/${parseIso}.ask.ts`),
  },
  {
    content: [
      `import { expect, it } from "bun:test";`,
      `import { parse } from "../src/parse.ts";`,
      ``,
      `it("parse reads the year of an ISO date", () => {`,
      `  expect(parse("2026-10-07").year).toBe(2026);`,
      `});`,
      ``,
    ].join("\n"),
    path: RepoPath.make(`test/${parseIso}.test.ts`),
  }
);

/**
 * The log the platform keeps of a `unit` lane the Checker failed: what the
 * run said of the lane, since a scripted run has no output of its own.
 */
const unitLog = [
  "unit: failed in 1 ms",
  "$ run unit",
  "unit: scripted failure",
].join("\n");

/** One object as the fake bucket keeps it. */
interface Kept {
  readonly text: string;
  readonly customMetadata: Readonly<Record<string, string>>;
}

/** The stage's evidence bucket in memory, in the shape of the Worker's `EVIDENCE` binding. */
const fakeBucket = () => {
  const objects = new Map<string, Kept>();

  const bucket: EvidenceBucket = {
    get: (key) => {
      const kept = objects.get(key);

      return Promise.resolve(
        kept === undefined ? null : { text: () => Promise.resolve(kept.text) }
      );
    },
    put: (key, text, { customMetadata }) => {
      objects.set(key, { customMetadata, text });

      return Promise.resolve({ key });
    },
  };

  return { bucket, objects };
};

/**
 * dora makes datekit and opens parse-iso; alice claims it and answers in
 * scope, and on the merged tree her ask's check passes and `unit` fails,
 * while `unit` passes on main: the answer is refused `ChecksFailed`.
 */
const refused = Effect.gen(function* () {
  const { bucket, objects } = fakeBucket();
  const world = yield* coreLoopWorld({ evidence: EvidenceStoreR2(bucket) });
  const dora = world.rpc("dora");
  const alice = world.rpc("alice");
  const doraGit = world.git("dora");
  const aliceGit = world.git("alice");

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

  const opened = yield* dora.openAsk({
    ask: parseIso,
    files: askFiles,
    project,
  });

  const { claim } = yield* alice.claim({ ask: parseIso, project });
  const work = yield* aliceGit.clone(claim.remote);

  const fix = yield* aliceGit.commit(work, "Read the year", {
    "src/parse.ts":
      "export const parse = (iso: string) => ({ month: 0, year: Number(iso.slice(0, 4)) });\n",
  });

  const pushed = yield* aliceGit.push(work);

  const tree = TreeSha.make(
    yield* aliceGit.ok(work, "rev-parse", `${fix}^{tree}`)
  );

  const merged = CheckAt.cases.Tree.make({ tree });

  yield* world.script(merged, redThenGreen, ["passed"]);
  yield* world.script(merged, unit, ["failed"]);
  yield* world.script(
    CheckAt.cases.Commit.make({ commit: CommitSha.make(opened.landed) }),
    unit,
    ["passed"]
  );

  yield* world.settle();

  const { verdict } = yield* alice.verdict({ ask: parseIso, project });

  const logRef = verdict?.lanes.find(({ lane }) => lane === unit)?.logRef ?? "";

  return { aliceGit, logRef, objects, pushed, verdict, work, world };
});

/** How a read ended, success or refusal, as JSON. */
const json = <A, E>(read: Effect.Effect<A, E>) =>
  Effect.map(Effect.exit(read), (exit) => JSON.stringify(exit));

/** Everything `who` can read over `/rpc` besides `evidence`, as JSON. */
const everythingElse = (
  world: Effect.Success<typeof refused>["world"],
  who: Someone | "anonymous"
) =>
  Effect.gen(function* () {
    const rpc = world.rpc(who);

    return [
      yield* json(rpc.listProjects({})),
      yield* json(rpc.frontPage({})),
      yield* json(rpc.listAsks({ project })),
      yield* json(rpc.showAsk({ ask: parseIso, project })),
      yield* json(rpc.verdict({ ask: parseIso, project })),
      yield* json(rpc.credits({ handle: Handle.make("alice") })),
      yield* json(rpc.ledger({ project })),
      yield* json(rpc.envShape({ project })),
      yield* json(rpc.status({ project })),
      yield* json(rpc.today({ project })),
      yield* json(Stream.runCollect(rpc.watch({ project }))),
    ];
  });

describe("a failing lane's log, through the platform", () => {
  it("takes the Worker's EVIDENCE binding as its bucket", () => {
    expectTypeOf<Env["EVIDENCE"]>().toExtend<EvidenceBucket>();
  });

  it.effect(
    "keeps the Worker's lane logs in its EVIDENCE bucket, not in memory",
    () =>
      Effect.gen(function* () {
        const config = yield* decodeEnv(fakeEnv()).pipe(Effect.orDie);

        const exit = yield* Effect.exit(
          EvidenceStore.use((store) =>
            store.put({
              attempt: 1,
              lane: unit,
              project,
              requestId: RequestId.make("req-fix-0001"),
              text: unitLog,
            })
          ).pipe(Effect.provide(workerPorts(config)))
        );

        // The fake env's EVIDENCE throws when touched: the store reached it.
        expect(
          Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "it kept the log"
        ).toContain("could not put dora__datekit/req-fix-0001/unit#1");
      })
  );

  it.live(
    "keeps the log of a lane that failed, and the refusal names only where",
    () =>
      Effect.gen(function* () {
        const { logRef, objects, verdict } = yield* refused;

        expect({
          kept: objects.get(logRef),
          outcome: verdict?.outcome,
        }).toStrictEqual({
          kept: {
            customMetadata: { lane: "unit", project: "dora/datekit" },
            text: unitLog,
          },
          outcome: Outcome.cases.Refused.make({
            refusals: [
              new ChecksFailed({ lane: unit, logRef, next: "run unit" }),
            ],
          }),
        });
      }),
    60_000
  );

  it.live(
    "gives the log to the answer's claimant and to a decider, and refuses everyone else",
    () =>
      Effect.gen(function* () {
        const { logRef, objects, world } = yield* refused;
        const ref = { project, ref: logRef };

        const asked = (who: Someone | "anonymous", payload = ref) =>
          Effect.exit(world.rpc(who).evidence(payload));

        // A name pointing at another project: a real one bob makes, and one
        // nobody made, both read as that project unknown.
        yield* world
          .rpc("bob")
          .initProject({ project: ProjectName.make("bob/burrow") });

        // A log's name carries its project's key (ADR 0032).
        const elsewhere = (other: string) => ({
          project,
          ref: logRef.replace(
            `${keyOf(project)}/`,
            `${keyOf(ProjectName.make(other))}/`
          ),
        });

        const read = {
          alice: yield* asked("alice"),
          anonymous: yield* asked("anonymous"),
          bob: yield* asked("bob"),
          dora: yield* asked("dora"),
          ghost: yield* asked("dora", {
            project: ProjectName.make("alice/ghost"),
            ref: logRef.replace(`${keyOf(project)}/`, "alice__ghost/"),
          }),
          inBurrow: yield* asked("dora", elsewhere("bob/burrow")),
          inGhost: yield* asked("dora", elsewhere("alice/ghost")),
        };

        const whole = { lane: unit, text: unitLog, truncated: false };

        expect(read).toStrictEqual({
          alice: Exit.succeed(whole),
          anonymous: Exit.fail(new Unauthenticated()),
          bob: Exit.fail(new NotDecider({})),
          dora: Exit.succeed(whole),
          ghost: Exit.fail(
            new UnknownProject({ project: ProjectName.make("alice/ghost") })
          ),
          inBurrow: Exit.fail(
            new UnknownProject({
              project: ProjectName.make("bob/burrow"),
            })
          ),
          inGhost: Exit.fail(
            new UnknownProject({ project: ProjectName.make("alice/ghost") })
          ),
        });

        // A log over 256 KiB comes back as its last 256 KiB.
        const long = `${"x".repeat(300 * 1024)}\n${unitLog}`;
        const kept = objects.get(logRef);

        if (kept !== undefined) {
          objects.set(logRef, { ...kept, text: long });
        }

        const cut = yield* world.rpc("dora").evidence(ref);

        expect({
          bytes: new TextEncoder().encode(cut.text).length,
          isTail: long.endsWith(cut.text),
          truncated: cut.truncated,
        }).toStrictEqual({ bytes: 256 * 1024, isTail: true, truncated: true });
      }),
    60_000
  );

  it.live(
    "never puts the log in another /rpc response or in git's remote: lines",
    () =>
      Effect.gen(function* () {
        const { aliceGit, pushed, work, world } = yield* refused;

        // Read first: the refused answer is still alice's latest.
        const read = [
          ...(yield* everythingElse(world, "alice")),
          ...(yield* everythingElse(world, "bob")),
          ...(yield* everythingElse(world, "dora")),
          ...(yield* everythingElse(world, "anonymous")),
        ];

        // Then alice tries again: this push's remote: lines are printed
        // while the refused answer's log is kept, unlike her first push's.
        yield* aliceGit.commit(work, "Read the year, trimmed", {
          "src/parse.ts":
            "export const parse = (iso: string) => ({ month: 0, year: Number(iso.slice(0, 4).trim()) });\n",
        });

        const again = yield* aliceGit.push(work);

        // The log whole, as JSON escapes it, and its one line no other
        // record of the run holds: the failure's signature.
        const needles = [
          unitLog,
          JSON.stringify(unitLog).slice(1, -1),
          "unit: scripted failure",
        ];

        const seen = [pushed.stderr, again.stderr, ...read];

        expect({
          again: {
            exitCode: again.exitCode,
            reached: again.stderr.includes("remote:"),
          },
          leaks: seen.filter((text) =>
            needles.some((needle) => text.includes(needle))
          ),
        }).toStrictEqual({ again: { exitCode: 0, reached: true }, leaks: [] });
      }),
    60_000
  );
});
