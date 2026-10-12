import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  HostBusy,
  ObjectId,
  RefName,
  RepoHost,
  RepoName,
  RepoNotFound,
} from "@repo/artifacts/repo-host";
import type { RefUpdate } from "@repo/artifacts/repo-host";
import { RepoHostLocal } from "@repo/artifacts/repo-host/local";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { pushRefs } from "@repo/artifacts/repo-host/smart-http";
import { Brand } from "@repo/brand";
import { CheckAt } from "@repo/checks/check-runner";
import { Verdict } from "@repo/protocol/domain/answer";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CheckVersion,
  CommitSha,
  LandedSha,
  LaneName,
  PatchId,
  ProjectName,
  TreeSha,
} from "@repo/protocol/ids";
import { ChecksFailed } from "@repo/protocol/refusal";
import { git, gitOk } from "@repo/testkit/git";
import { gitClient } from "@repo/testkit/git-client";
import { httpBackend } from "@repo/testkit/http-backend";
import {
  Context,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import type { Scope } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { WorkerFetch } from "../src/adapters/fetch.ts";
import { runAnswer } from "../src/workflows/answer/program.ts";
import { notesRef, writeVerdictNote } from "../src/workflows/notes.ts";
import { memoSteps } from "../src/workflows/step.ts";
import type { StepRunner } from "../src/workflows/step.ts";
import {
  admitted,
  askLane,
  bobFork,
  Checker,
  logged,
  mainTip,
  parsePath,
  project,
  scriptProjectLanes,
  StepLog,
  verdictOf,
  world,
} from "./workflows/answer.fixtures.ts";
import type { Admitted } from "./workflows/answer.fixtures.ts";

const fork = RepoName.make("alice__datekit--fix-week--alice");

const main = RefName.make("refs/heads/main");

const unit = LaneName.make("unit");

const refusedOn = (head: CommitSha) =>
  Verdict.make({
    ask: AskId.make("fix-week"),
    at: DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
    base: CommitSha.make("1".repeat(40)),
    checkVersion: CheckVersion.make("redThenGreen@0.0.0+abc"),
    head,
    heldBack: [],
    lanes: [
      {
        command: "bun run test",
        durationMs: 1200,
        lane: unit,
        result: "failed",
      },
    ],
    outcome: Outcome.cases.Refused.make({
      refusals: [
        new ChecksFailed({
          lane: unit,
          logRef: `datekit/push-${head}-alice/unit#1`,
          next: "bun run test",
        }),
      ],
    }),
    patchId: PatchId.make("2".repeat(64)),
    project: ProjectName.make("alice/datekit"),
    stage: "checks",
    tree: TreeSha.make("3".repeat(40)),
    verifier: "platform",
  });

const landedOn = (head: CommitSha) =>
  Verdict.make({
    ...refusedOn(head),
    at: DateTime.makeUnsafe("2026-10-07T12:20:00Z"),
    lanes: [
      {
        command: "bun run test",
        durationMs: 900,
        lane: unit,
        result: "passed",
      },
    ],
    outcome: Outcome.cases.Landed.make({
      sha: LandedSha.make("4".repeat(40)),
    }),
    stage: "human",
  });

const encoded = Schema.encodeEffect(Verdict);

const asVerdict = (note: Option.Option<string>) =>
  Effect.option(
    Schema.decodeEffect(Schema.fromJsonString(Verdict))(
      Option.getOrElse(note, () => "")
    ).pipe(Effect.flatMap(encoded))
  );

const served = (root: string) =>
  Effect.gen(function* () {
    const node = yield* Effect.context<NodeServices.NodeServices>();

    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.toWeb(
        yield* HttpServerRequest.HttpServerRequest
      );

      return HttpServerResponse.fromWeb(
        yield* Effect.scoped(httpBackend(root)(request)).pipe(
          Effect.provideContext(node)
        )
      );
    }).pipe(Effect.orDie);

    const server = yield* Layer.build(
      HttpServer.serve(app).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
    ).pipe(Effect.orDie);

    const { address } = Context.get(server, HttpServer.HttpServer);

    return "port" in address
      ? `http://127.0.0.1:${address.port}`
      : yield* Effect.die("the test server listens on a socket, not a port");
  });

interface DiskWorld {
  readonly host: RepoHost["Service"];
  readonly work: string;
}

const diskWorld: Effect.Effect<
  DiskWorld,
  never,
  NodeServices.NodeServices | Scope.Scope
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
  const work = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);

  const hosts = yield* Layer.build(
    RepoHostLocal.layer({ remoteBase: yield* served(root), root }).pipe(
      Layer.provide(WorkerFetch)
    )
  );

  return { host: Context.get(hosts, RepoHost), work };
});

const forkWithTwoHeads = (host: RepoHost["Service"]) =>
  Effect.gen(function* () {
    const client = yield* gitClient(memoryFs());

    yield* host.create(fork).pipe(Effect.orDie);

    const first = yield* client.commit("Work", [
      ["src/week.ts", "export const week = 1;\n"],
    ]);

    const second = yield* client.commit(
      "Work",
      [["src/week.ts", "export const week = 2;\n"]],
      [first]
    );

    yield* host
      .push(fork, client.source, [
        { from: Option.none(), ref: main, to: second },
      ])
      .pipe(Effect.orDie);

    return { first, second };
  });

const write = (disk: DiskWorld, head: CommitSha, verdict: Verdict) =>
  writeVerdictNote({ fork, head, verdict }).pipe(
    Effect.provideService(RepoHost, disk.host)
  );

const movedUnder = (disk: DiskWorld, stale: number) =>
  Effect.gen(function* () {
    const listings = yield* Ref.make(0);
    const pushes = yield* Ref.make(0);

    const host = RepoHost.of({
      ...disk.host,
      push: (name, source, updates) =>
        Effect.andThen(
          Ref.update(pushes, (n) => n + 1),
          disk.host.push(name, source, updates)
        ),
      refs: (name) =>
        Effect.gen(function* () {
          const listed = yield* Ref.getAndUpdate(listings, (n) => n + 1);
          const refs = yield* disk.host.refs(name);

          return listed < stale
            ? new Map([...refs].filter(([ref]) => ref !== notesRef))
            : refs;
        }),
    });

    return { host, pushes: Ref.get(pushes) };
  });

const overSmartHttp = (disk: DiskWorld) =>
  RepoHost.of({
    ...disk.host,
    push: (name, source, updates) =>
      Effect.flatMap(disk.host.remote(name), (remote) =>
        pushRefs({
          remote,
          source,
          token: Redacted.make("a-write-token"),
          updates,
        }).pipe(Effect.provide(WorkerFetch))
      ),
  });

const recordingPushes = (disk: DiskWorld) =>
  Effect.map(Ref.make<readonly (readonly RefUpdate[])[]>([]), (pushed) => ({
    host: RepoHost.of({
      ...disk.host,
      push: (name, source, updates) =>
        Effect.andThen(
          Ref.update(pushed, (all) => [...all, updates]),
          disk.host.push(name, source, updates)
        ),
    }),
    pushed: Ref.get(pushed),
  }));

const notesTip = (host: RepoHost["Service"]) =>
  Effect.map(host.refs(fork).pipe(Effect.orDie), (refs) =>
    Option.fromNullishOr(refs.get(notesRef))
  );

const noteInClone = (disk: DiskWorld, name: string, head: CommitSha) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const clone = `${disk.work}/${name}`;

    if (!(yield* fs.exists(clone).pipe(Effect.orDie))) {
      const remote = yield* disk.host.remote(fork).pipe(Effect.orDie);

      yield* gitOk(disk.work, "clone", "--quiet", remote, name);
    }

    const ref = `refs/notes/${Brand.slug}`;

    yield* git(clone, "fetch", "--quiet", "origin", `${ref}:${ref}`);

    const shown = yield* git(
      clone,
      "notes",
      `--ref=${Brand.slug}`,
      "show",
      head
    );

    return shown.exitCode === 0 ? Option.some(shown.stdout) : Option.none();
  });

describe(writeVerdictNote, () => {
  it.live(
    "puts the verdict on the head in the fork, where a fresh clone reads it with plain git",
    () =>
      Effect.gen(function* () {
        const disk = yield* diskWorld;

        const { first: head } = yield* forkWithTwoHeads(disk.host);

        const verdict = refusedOn(head);
        const written = yield* write(disk, head, verdict);
        const note = yield* noteInClone(disk, "fresh", head);

        expect(yield* asVerdict(note)).toStrictEqual(
          Option.some(yield* encoded(verdict))
        );
        expect(
          note.pipe(Option.map((text) => text.endsWith("}\n")))
        ).toStrictEqual(Option.some(true));
        expect(written).toStrictEqual({
          changed: true,
          notesTip: Option.getOrThrow(yield* notesTip(disk.host)),
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "writing the same verdict again leaves the notes ref's tip where it was",
    () =>
      Effect.gen(function* () {
        const disk = yield* diskWorld;

        const { first: head } = yield* forkWithTwoHeads(disk.host);

        const first = yield* write(disk, head, refusedOn(head));
        const again = yield* write(disk, head, refusedOn(head));

        expect(again).toStrictEqual({
          changed: false,
          notesTip: first.notesTip,
        });
        expect(yield* notesTip(disk.host)).toStrictEqual(
          Option.some(first.notesTip)
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a newer verdict on the same head replaces its note, the notes on other heads stay, and the same fetch brings it",
    () =>
      Effect.gen(function* () {
        const disk = yield* diskWorld;

        const { first, second } = yield* forkWithTwoHeads(disk.host);

        yield* write(disk, first, refusedOn(first));
        yield* write(disk, second, refusedOn(second));

        const before = yield* noteInClone(disk, "answerer", first);
        const replaced = yield* write(disk, first, landedOn(first));

        expect(yield* asVerdict(before)).toStrictEqual(
          Option.some(yield* encoded(refusedOn(first)))
        );
        expect(replaced.changed).toBeTruthy();
        expect(
          yield* asVerdict(yield* noteInClone(disk, "answerer", first))
        ).toStrictEqual(Option.some(yield* encoded(landedOn(first))));
        expect(
          yield* asVerdict(yield* noteInClone(disk, "answerer", second))
        ).toStrictEqual(Option.some(yield* encoded(refusedOn(second))));
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "pushes the notes ref alone, never forced: a compare-and-swap from the tip it listed",
    () =>
      Effect.gen(function* () {
        const disk = yield* diskWorld;

        const { first, second } = yield* forkWithTwoHeads(disk.host);

        const recording = yield* recordingPushes(disk);

        const noted = (head: CommitSha) =>
          writeVerdictNote({ fork, head, verdict: refusedOn(head) }).pipe(
            Effect.provideService(RepoHost, recording.host)
          );

        const one = yield* noted(first);
        const two = yield* noted(second);

        expect(yield* recording.pushed).toStrictEqual([
          [{ from: Option.none(), ref: notesRef, to: one.notesTip }],
          [
            {
              from: Option.some(one.notesTip),
              ref: notesRef,
              to: two.notesTip,
            },
          ],
        ]);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a notes ref that moved under the write is read again, and the note goes on top of the move",
    () =>
      Effect.gen(function* () {
        const disk = yield* diskWorld;

        const { first, second } = yield* forkWithTwoHeads(disk.host);

        const moved = yield* write(disk, first, refusedOn(first));
        const racing = yield* movedUnder(disk, 1);

        const written = yield* writeVerdictNote({
          fork,
          head: second,
          verdict: refusedOn(second),
        }).pipe(Effect.provideService(RepoHost, racing.host));

        const tip = yield* notesTip(disk.host);

        expect(written).toStrictEqual({
          changed: true,
          notesTip: Option.getOrThrow(tip),
        });
        expect(yield* racing.pushes).toBe(2);
        expect(
          Option.map(
            yield* disk.host
              .readCommit(fork, Option.getOrThrow(tip))
              .pipe(Effect.orDie),
            ({ parents }) => parents
          )
        ).toStrictEqual(Option.some([moved.notesTip]));
        expect(
          yield* asVerdict(yield* noteInClone(disk, "answerer", first))
        ).toStrictEqual(Option.some(yield* encoded(refusedOn(first))));
        expect(
          yield* asVerdict(yield* noteInClone(disk, "answerer", second))
        ).toStrictEqual(Option.some(yield* encoded(refusedOn(second))));
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "a notes ref that moves under the write twice is busy, and stays where the last move put it",
    () =>
      Effect.gen(function* () {
        const disk = yield* diskWorld;

        const { first, second } = yield* forkWithTwoHeads(disk.host);

        const moved = yield* write(disk, first, refusedOn(first));
        const racing = yield* movedUnder(disk, Number.POSITIVE_INFINITY);

        const exit = yield* Effect.exit(
          writeVerdictNote({
            fork,
            head: second,
            verdict: refusedOn(second),
          }).pipe(Effect.provideService(RepoHost, racing.host))
        );

        expect(exit).toStrictEqual(Exit.fail(new HostBusy({ name: fork })));
        expect(yield* racing.pushes).toBe(2);
        expect(yield* notesTip(disk.host)).toStrictEqual(
          Option.some(moved.notesTip)
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.live(
    "pushes over git smart HTTP as the binding does, the notes on other heads included",
    () =>
      Effect.gen(function* () {
        const disk = yield* diskWorld;

        const { first, second } = yield* forkWithTwoHeads(disk.host);

        const written = yield* Effect.exit(
          Effect.andThen(
            writeVerdictNote({ fork, head: first, verdict: refusedOn(first) }),
            writeVerdictNote({ fork, head: second, verdict: refusedOn(second) })
          ).pipe(Effect.provideService(RepoHost, overSmartHttp(disk)))
        );

        expect(Exit.isSuccess(written)).toBeTruthy();
        expect(
          yield* asVerdict(yield* noteInClone(disk, "answerer", first))
        ).toStrictEqual(Option.some(yield* encoded(refusedOn(first))));
        expect(
          yield* asVerdict(yield* noteInClone(disk, "answerer", second))
        ).toStrictEqual(Option.some(yield* encoded(refusedOn(second))));
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );
});

const noteOnBobsFork = (head: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const tip = (yield* host.refs(bobFork).pipe(Effect.orDie)).get(notesRef);

    if (tip === undefined) {
      return Option.none();
    }

    const commit = Option.getOrThrow(
      yield* host.readCommit(bobFork, tip).pipe(Effect.orDie)
    );

    const entries = Option.getOrThrow(
      yield* host.readTree(bobFork, commit.tree).pipe(Effect.orDie)
    );

    const entry = entries.find(({ name }) => name === head);

    const blob =
      entry === undefined
        ? Option.none()
        : yield* host
            .readBlob(bobFork, ObjectId.make(entry.sha))
            .pipe(Effect.orDie);

    return Option.some({
      note: Option.map(blob, (bytes) => new TextDecoder().decode(bytes)),
      parents: commit.parents,
      tip,
    });
  });

const countingNotes = (
  options: { readonly busy?: number; readonly refuse?: boolean } = {}
) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const pushes = yield* Ref.make(0);

    const counted = RepoHost.of({
      ...host,
      push: (name, source, updates) =>
        name === bobFork && updates.some(({ ref }) => ref === notesRef)
          ? Effect.flatMap(
              Ref.getAndUpdate(pushes, (n) => n + 1),
              (before): ReturnType<typeof host.push> => {
                if (options.refuse === true) {
                  return Effect.fail(new RepoNotFound({ name }));
                }

                return before < (options.busy ?? 0)
                  ? Effect.fail(new HostBusy({ name }))
                  : host.push(name, source, updates);
              }
            )
          : host.push(name, source, updates),
    });

    return { counted, pushes: Ref.get(pushes) };
  });

const freshSteps = Effect.flatMap(memoSteps(), (memo) =>
  Layer.build(logged(memo))
);

const unitFails = (answer: Admitted) =>
  Effect.gen(function* () {
    yield* scriptProjectLanes(answer.merged, { result: "passed" });
    yield* Checker.use((script) =>
      Effect.all([
        script.script(answer.merged, askLane, [{ result: "passed" }]),
        script.script(answer.merged, unit, [
          {
            result: "failed",
            signature: `parses ISO weeks: AssertionError: expected {} to equal { year: 2026 } at ${parsePath}:1:22`,
          },
        ]),
        script.script(
          CheckAt.cases.Commit.make({ commit: answer.opened }),
          unit,
          [{ result: "passed" }]
        ),
      ])
    );
  });

const allGreen = (answer: Admitted) =>
  Effect.andThen(
    scriptProjectLanes(answer.merged, { result: "passed" }),
    Checker.use((script) =>
      script.script(answer.merged, askLane, [{ result: "passed" }])
    )
  );

const runOver = (
  answer: Admitted,
  steps: Context.Context<StepRunner | StepLog>,
  host: RepoHost["Service"]
) =>
  runAnswer({ project, requestId: answer.requestId }).pipe(
    Effect.provide(steps),
    Effect.provideService(RepoHost, host)
  );

const noteIn = (
  noted: Option.Option<{ readonly note: Option.Option<string> }>
) => asVerdict(Option.flatMap(noted, ({ note }) => note));

describe(runAnswer, () => {
  it.effect(
    "a run its checks refuse leaves its verdict, as `verdict` shows it, as the note on the head in the fork",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* unitFails(answer);

        const { counted, pushes } = yield* countingNotes();
        const outcome = yield* runOver(answer, yield* freshSteps, counted);
        const noted = yield* noteOnBobsFork(answer.head);
        const verdict = Option.getOrThrow(yield* verdictOf(answer.api));

        expect(Outcome.guards.Refused(outcome)).toBeTruthy();
        expect(verdict.outcome).toStrictEqual(outcome);
        expect(yield* noteIn(noted)).toStrictEqual(
          Option.some(yield* encoded(verdict))
        );
        expect(Option.map(noted, ({ parents }) => parents)).toStrictEqual(
          Option.some([])
        );
        expect(yield* pushes).toBe(1);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "a replay of the run writes no second notes commit, and a restarted run writes the same note, which changes nothing",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* unitFails(answer);

        const { counted, pushes } = yield* countingNotes();
        const steps = yield* freshSteps;
        const outcome = yield* runOver(answer, steps, counted);
        const noted = yield* noteOnBobsFork(answer.head);

        expect(yield* runOver(answer, steps, counted)).toStrictEqual(outcome);
        expect(yield* pushes).toBe(1);
        expect(
          (yield* StepLog.use(({ names }) => names).pipe(
            Effect.provide(steps)
          )).filter((name) => name.startsWith("notes:"))
        ).toStrictEqual(["notes:Refused", "notes:Refused"]);

        const restarted = yield* runOver(answer, yield* freshSteps, counted);

        expect({
          noted: yield* noteOnBobsFork(answer.head),
          outcome: restarted,
          pushes: yield* pushes,
        }).toStrictEqual({ noted, outcome, pushes: 1 });
      }).pipe(Effect.provide(world))
  );

  it.effect("a run that lands leaves the note saying where it landed", () =>
    Effect.gen(function* () {
      const answer = yield* admitted();

      yield* allGreen(answer);

      const { counted } = yield* countingNotes();
      const outcome = yield* runOver(answer, yield* freshSteps, counted);
      const tip = yield* mainTip;
      const noted = yield* noteOnBobsFork(answer.head);

      expect(outcome).toStrictEqual(Outcome.cases.Landed.make({ sha: tip }));
      expect(yield* noteIn(noted)).toStrictEqual(
        Option.some(
          yield* encoded(Option.getOrThrow(yield* verdictOf(answer.api)))
        )
      );
      expect(
        Option.map(yield* verdictOf(answer.api), (verdict) => verdict.outcome)
      ).toStrictEqual(Option.some(outcome));
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "a fork busy with another push is asked again, and the note is written",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* unitFails(answer);

        const { counted, pushes } = yield* countingNotes({ busy: 1 });

        // The step waits out its backoff on the TestClock: move the clock
        // on for as long as the run goes.
        const outcome = yield* Effect.race(
          runOver(answer, yield* freshSteps, counted),
          Effect.forever(TestClock.adjust("250 millis"))
        );

        const noted = yield* noteOnBobsFork(answer.head);

        expect(Outcome.guards.Refused(outcome)).toBeTruthy();
        expect(yield* pushes).toBe(2);
        expect(yield* noteIn(noted)).toStrictEqual(
          Option.some(
            yield* encoded(Option.getOrThrow(yield* verdictOf(answer.api)))
          )
        );
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "a note the fork refuses leaves the run's outcome as it was, in the run and in its replay",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* unitFails(answer);

        const { counted, pushes } = yield* countingNotes({ refuse: true });
        const steps = yield* freshSteps;
        const outcome = yield* runOver(answer, steps, counted);

        expect(Outcome.guards.Refused(outcome)).toBeTruthy();
        expect(yield* pushes).toBe(1);
        expect(yield* noteOnBobsFork(answer.head)).toStrictEqual(Option.none());
        expect(yield* runOver(answer, steps, counted)).toStrictEqual(outcome);
        expect(yield* pushes).toBe(1);
      }).pipe(Effect.provide(world))
  );
});
