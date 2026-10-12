import { describe, expect, it } from "@effect/vitest";
import { ObjectId, RepoHost, RepoNotFound } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { CheckAt, CheckRunner, shaOf } from "@repo/checks/check-runner";
import type { CheckJob } from "@repo/checks/check-runner";
import { CheckExit } from "@repo/checks/check-runner/wire";
import type { CheckWire } from "@repo/checks/check-runner/wire";
import { EvidenceKept } from "@repo/checks/evidence-store/memory";
import { parseTrailers } from "@repo/git/trailers";
import { AnswerView, Verdict } from "@repo/protocol/domain/answer";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import { Command } from "@repo/protocol/domain/common";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  EnvKey,
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
  RequestId,
  SuiteRoot,
  TreeSha,
} from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import {
  AttemptsExhausted,
  ChecksFailed,
  HeldBackFailed,
  LayerContentInPublicTree,
  PrivatePathInPublicTree,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import type { Files } from "@repo/testkit/git-client";
import { untouchable } from "@repo/testkit/untouchable";
import {
  Array,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Struct,
} from "effect";

import { CheckRunnerSandbox } from "../../src/adapters/check-runner-sandbox.ts";
import type { SandboxBinding } from "../../src/adapters/check-runner-sandbox.ts";
import { decodeEnv } from "../../src/platform.ts";
import { workerPorts } from "../../src/ports.ts";
import { LandingGuards } from "../../src/workflows/answer/guards.ts";
import { withheld } from "../../src/workflows/answer/lanes.ts";
import { runAnswer } from "../../src/workflows/answer/program.ts";
import { notesRef } from "../../src/workflows/notes.ts";
import { memoSteps } from "../../src/workflows/step.ts";
import type { StepRunner } from "../../src/workflows/step.ts";
import { fakeEnv } from "../fake-env.ts";
import {
  admitted,
  alice,
  askLane,
  bob,
  bobFork,
  changed,
  Checker,
  finishRequired,
  fixed,
  LanderCalls,
  lexPath,
  logged,
  mainMoved,
  mainTip,
  openedFiles,
  parseIso,
  parsePath,
  policy,
  project,
  Pusher,
  repo,
  scriptProjectLanes,
  Started,
  verdictOf,
} from "../workflows/answer.fixtures.ts";
import type { Admitted } from "../workflows/answer.fixtures.ts";
import {
  exportArea,
  heldBackJob,
  maintainers,
  parserArea,
  resetsAt,
  sealedFiles,
  Sealed,
  sealedWorld,
  suiteRoot,
} from "./held-back.fixtures.ts";

const run = (answer: Admitted) =>
  Effect.flatMap(memoSteps(), (steps) =>
    runAnswer({ project, requestId: answer.requestId }).pipe(
      Effect.provide(steps)
    )
  );

const allGreen = (at: CheckAt) =>
  Effect.andThen(
    scriptProjectLanes(at, { result: "passed" }),
    Checker.use((script) => script.script(at, askLane, [{ result: "passed" }]))
  );

const failing = (...areas: readonly (typeof exportArea)[]) =>
  Sealed.use(({ failing: next }) => Ref.set(next, new Set(areas)));

const decodeVerdict = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Verdict)
);

const noteIn = (at: RepoName, commit: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const tip = (yield* host.refs(at).pipe(Effect.orDie)).get(notesRef);

    if (tip === undefined) {
      return Option.none();
    }

    const notes = Option.getOrThrow(
      yield* host.readCommit(at, tip).pipe(Effect.orDie)
    );

    const entries = Option.getOrThrow(
      yield* host.readTree(at, notes.tree).pipe(Effect.orDie)
    );

    const entry = entries.find(({ name }) => name === commit);

    if (entry === undefined) {
      return Option.none();
    }

    const blob = Option.getOrThrow(
      yield* host.readBlob(at, ObjectId.make(entry.sha)).pipe(Effect.orDie)
    );

    return Option.some(
      yield* decodeVerdict(new TextDecoder().decode(blob)).pipe(Effect.orDie)
    );
  });

const noteOn = (head: CommitSha) => noteIn(bobFork, head);

const answerAgain = (answer: Admitted, files: Files) =>
  Effect.gen(function* () {
    const head = yield* Pusher.use((each) =>
      each.push(bobFork, Option.some(answer.head), files)
    );

    const merged = yield* LanderCalls.use((calls) =>
      calls.preview({
        base: answer.opened,
        fork: bobFork,
        head,
        main: answer.opened,
        repo,
      })
    );

    const receipt = yield* answer.api.submitAnswer(bob, {
      ask: parseIso,
      base: answer.opened,
      head,
      requestId: RequestId.make(`push-${head}`),
    });

    yield* allGreen(merged);

    return { ...answer, head, merged, requestId: receipt.requestId };
  }).pipe(Effect.orDie);

describe("the held-back step", () => {
  it.effect(
    "refuses an answer whose public checks pass and whose export check fails, in its verdict, its note and status, and lands nothing",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);
        yield* failing(exportArea);

        const outcome = yield* run(answer);
        const { answers } = yield* answer.api.status(bob);

        const refused = Outcome.cases.Refused.make({
          refusals: [
            new HeldBackFailed({ area: exportArea, suite: suiteRoot }),
          ],
        });

        expect(outcome).toStrictEqual(refused);
        expect(
          Option.map(
            yield* verdictOf(answer.api),
            ({ outcome: judged }) => judged
          )
        ).toStrictEqual(Option.some(refused));
        expect(
          Option.map(yield* noteOn(answer.head), ({ outcome: noted }) => noted)
        ).toStrictEqual(Option.some(refused));
        expect(answers.map((each) => each.outcome)).toStrictEqual([refused]);
        expect(yield* mainTip).toBe(answer.opened);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "counts one attempt per held-back run, however often the Workflow is replayed or its steps run twice",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);
        yield* failing(exportArea);

        const steps = yield* memoSteps();

        const over = (record: Layer.Layer<StepRunner>) =>
          runAnswer({ project, requestId: answer.requestId }).pipe(
            Effect.provide(record)
          );

        const twice = Layer.unwrap(
          Effect.map(memoSteps(), (memo) => logged(memo, { twice: true }))
        );

        const outcomes = [
          yield* over(twice),
          yield* over(steps),
          yield* over(steps),
        ];

        const second = yield* answerAgain(
          answer,
          changed(
            fixed,
            parsePath,
            "export const parse = (s) => ({ year: 2026, s });\n"
          )
        );

        expect(outcomes).toStrictEqual([outcomes[0], outcomes[0], outcomes[0]]);
        expect(yield* Sealed.use(({ judged }) => judged)).toBe(1);
        expect(yield* run(second)).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new HeldBackFailed({ area: exportArea, suite: suiteRoot }),
            ],
          })
        );
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "carries a passing held-back result over a moved main to the re-merged tree, whose public lanes run again",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);

        const moved = yield* mainMoved(
          answer.opened,
          changed(
            openedFiles,
            lexPath,
            "export const lex = (s) => s.split(/ +/);\n"
          )
        );

        const remerged = yield* LanderCalls.use(({ preview }) =>
          preview({
            base: answer.opened,
            fork: bobFork,
            head: answer.head,
            main: moved,
            repo,
          })
        );

        yield* allGreen(remerged);

        const outcome = yield* run(answer);
        const tip = yield* mainTip;
        const sealedJobs = yield* Sealed.use(({ jobs }) => Ref.get(jobs));
        const { landing } = yield* answer.api.landing(bob, tip);

        const publicTrees = yield* Checker.use(({ jobs }) =>
          Effect.map(jobs, (all) =>
            Array.dedupe(
              all
                .filter(({ at }) => CheckAt.guards.Tree(at))
                .map(({ at }) => shaOf(at))
            )
          )
        );

        expect(outcome).toStrictEqual(Outcome.cases.Landed.make({ sha: tip }));
        expect(publicTrees).toStrictEqual([
          shaOf(answer.merged),
          shaOf(remerged),
        ]);
        expect(sealedJobs.map(({ at }) => at)).toStrictEqual([answer.merged]);
        expect(landing.heldBackTrailer).toBe(
          `export 2/2 @ ${suiteRoot}; parser 1/1 @ ${suiteRoot}`
        );
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "waits, counting nothing, when the Checker cannot run the suite",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);
        yield* Sealed.use(({ blocked }) => Ref.set(blocked, true));

        const outcome = yield* run(answer);

        expect(outcome).toStrictEqual(
          Outcome.cases.Checking.make({ stage: "checks" })
        );
        expect(yield* Sealed.use(({ judged }) => judged)).toBe(0);
        expect(yield* mainTip).toBe(answer.opened);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "spends the area on the claim's third failed run: AttemptsExhausted",
    () =>
      Effect.gen(function* () {
        const first = yield* admitted();

        yield* allGreen(first.merged);
        yield* failing(exportArea);

        const outcomes = [yield* run(first)];

        const second = yield* answerAgain(
          first,
          changed(
            fixed,
            parsePath,
            "export const parse = (s) => ({ year: 2026, s });\n"
          )
        );

        outcomes.push(yield* run(second));

        const third = yield* answerAgain(
          second,
          changed(
            fixed,
            parsePath,
            "export const parse = (s) => ({ year: 2026, t: s });\n"
          )
        );

        outcomes.push(yield* run(third));

        expect(
          outcomes.map((outcome) =>
            Outcome.guards.Refused(outcome)
              ? outcome.refusals.map(({ _tag }) => _tag)
              : outcome._tag
          )
        ).toStrictEqual([
          ["HeldBackFailed"],
          ["HeldBackFailed"],
          ["AttemptsExhausted"],
        ]);
        expect(outcomes[2]).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [new AttemptsExhausted({ area: exportArea, resetsAt })],
          })
        );
        expect(yield* mainTip).toBe(first.opened);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "lands an answer that passes every area with the Held-back trailer, from a job that carried the suite and nothing of the layer's",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);

        const outcome = yield* run(answer);
        const tip = yield* mainTip;
        const host = yield* RepoHost;

        const commit = Option.getOrThrow(
          yield* host.readCommit(repo, tip).pipe(Effect.orDie)
        );

        const { landing } = yield* answer.api.landing(bob, LandedSha.make(tip));
        const jobs = yield* Sealed.use(({ jobs: given }) => Ref.get(given));
        const value = `export 2/2 @ ${suiteRoot}; parser 1/1 @ ${suiteRoot}`;

        expect(outcome).toStrictEqual(
          Outcome.cases.Landed.make({ sha: LandedSha.make(tip) })
        );
        expect(
          parseTrailers(commit.message).filter(({ key }) => key === "Held-back")
        ).toStrictEqual([{ key: "Held-back", value }]);
        expect(landing.heldBackTrailer).toBe(value);
        expect(
          jobs.map((job) => ({
            at: job.at,
            files: job.heldBack?.files.map(({ area, path }) => [area, path]),
            lanes: job.lanes,
            repo: job.repo,
            suite: job.heldBack?.suite,
          }))
        ).toStrictEqual([
          {
            at: answer.merged,
            files: sealedFiles.map(({ area, path }) => [area, path]),
            lanes: [],
            repo: bobFork,
            suite: suiteRoot,
          },
        ]);
        expect(JSON.stringify(jobs)).not.toContain(maintainers);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );
});

const copied = RepoPath.make("packages/parser/src/copied.ts");

const copiedContent = sealedFiles[0]?.content ?? "";

const jobsOn = (at: CheckAt) =>
  Checker.use(({ jobs }) =>
    Effect.map(jobs, (all) => all.filter((job) => shaOf(job.at) === shaOf(at)))
  );

const encoder = new TextEncoder();

const blobIdOf = (text: string) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest(
        "SHA-1",
        encoder.encode(`blob ${encoder.encode(text).length}\0${text}`)
      )
    ),
    (digest) =>
      ObjectId.make(
        [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
      )
  );

const forkReads = (
  read: (
    id: ObjectId,
    given: Effect.Effect<Option.Option<Uint8Array>, RepoNotFound>
  ) => Effect.Effect<Option.Option<Uint8Array>, RepoNotFound>
) =>
  Effect.map(Effect.service(RepoHost), (host) =>
    RepoHost.of({
      ...host,
      readBlob: (name, id) =>
        name === bobFork
          ? read(id, host.readBlob(name, id))
          : host.readBlob(name, id),
    })
  );

describe("the landing guards", () => {
  it.effect(
    "are plugged into the Worker's ports with the cartridge, and nowhere without it",
    () =>
      Effect.gen(function* () {
        const config = yield* decodeEnv(fakeEnv()).pipe(Effect.orDie);

        const plugged = yield* Effect.scoped(
          Effect.flatMap(Layer.build(workerPorts(config)), (ports) =>
            Effect.provideContext(Effect.service(LandingGuards), ports)
          )
        );

        expect(Option.isSome(plugged)).toBeTruthy();
        expect(Option.isSome(yield* Effect.service(LandingGuards))).toBeFalsy();
      })
  );

  it.effect(
    "refuse a push that adds a layer's path at stage 1, before any check runs",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();
        const escape = "checks/held-back/export/escape.test.ts";

        const head = yield* Pusher.use((each) =>
          each.push(
            bobFork,
            Option.some(answer.head),
            changed(fixed, escape, 'it("escapes", () => {});\n')
          )
        );

        const refusals = yield* answer.api.recordPush({
          after: head,
          before: Option.some(answer.head),
          eventId: "push-escape",
          pusher: bob,
          ref: "refs/heads/main",
          repo: bobFork,
        });

        expect(refusals.map(({ _tag }) => _tag)).toContain(
          "PrivatePathInPublicTree"
        );
        expect(yield* Started.use(({ ids }) => ids)).toStrictEqual([
          answer.requestId,
        ]);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "refuse an admitted answer whose path a layer took since, before any check runs, naming all the answerer's paths to one who cannot read it",
    () =>
      Effect.gen(function* () {
        const taken = RepoPath.make("packages/parser/src/sealed.ts");

        const answer = yield* admitted(
          changed(fixed, taken, "export const sealed = 1;\n")
        );

        yield* allGreen(answer.merged);
        yield* Sealed.use(({ layerPaths }) =>
          Ref.update(layerPaths, (paths) => new Set([...paths, taken]))
        );

        expect(yield* run(answer)).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new PrivatePathInPublicTree({ paths: [parsePath, taken] }),
            ],
          })
        );
        expect(yield* jobsOn(answer.merged)).toStrictEqual([]);
        expect(yield* mainTip).toBe(answer.opened);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "refuse a finish whose finisher reads the layer and adds a file holding a layer's blob: LayerContentInPublicTree",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);

        expect(yield* run(answer)).toStrictEqual(
          Outcome.cases.AwaitingFinish.make({})
        );

        const finished = yield* Pusher.use((each) =>
          each.push(
            bobFork,
            Option.some(answer.head),
            changed(fixed, copied, copiedContent)
          )
        );

        const receipt = yield* answer.api
          .finish(alice, {
            ask: parseIso,
            base: answer.opened,
            head: finished,
            requestId: RequestId.make(`finish-${finished}`),
          })
          .pipe(Effect.orDie);

        expect(
          yield* runAnswer({ project, requestId: receipt.requestId }).pipe(
            Effect.provide(yield* memoSteps())
          )
        ).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [new LayerContentInPublicTree({ paths: [copied] })],
          })
        );
      }).pipe(Effect.provide(sealedWorld(finishRequired)))
  );

  it.effect(
    "say nothing of a layer's content to an answerer who cannot read it: the same file lands",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted(changed(fixed, copied, copiedContent));

        yield* allGreen(answer.merged);

        const outcome = yield* run(answer);

        expect(outcome).toStrictEqual(
          Outcome.cases.Landed.make({ sha: yield* mainTip })
        );
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "wait, running no check and counting nothing, when the answer's fork cannot be read for the files it writes",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* allGreen(answer.merged);

        const host = yield* forkReads(() =>
          Effect.fail(new RepoNotFound({ name: bobFork }))
        );

        const outcome = yield* run(answer).pipe(
          Effect.provideService(RepoHost, host)
        );

        expect(outcome).toStrictEqual(
          Outcome.cases.Checking.make({ stage: "checks" })
        );
        expect(yield* jobsOn(answer.merged)).toStrictEqual([]);
        expect(yield* mainTip).toBe(answer.opened);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "scan nothing for a change no blob in the fork holds, a submodule's pointer, and let the answer on",
    () =>
      Effect.gen(function* () {
        const content = "a pointer to a commit in another repo\n";

        const answer = yield* admitted(
          changed(fixed, "packages/parser/src/tz", content)
        );

        yield* allGreen(answer.merged);

        const pointer = yield* blobIdOf(content);

        const host = yield* forkReads((id, given) =>
          id === pointer ? Effect.succeedNone : given
        );

        const outcome = yield* run(answer).pipe(
          Effect.provideService(RepoHost, host)
        );

        expect(outcome).toStrictEqual(
          Outcome.cases.Landed.make({ sha: yield* mainTip })
        );
      }).pipe(Effect.provide(sealedWorld(policy)))
  );
});

const sentry = EnvKey.make("SENTRY_AUTH_TOKEN");

const token = "sntrys_0a1b2c3d4e5f6a7b8c9d";

const stored = (answer: Admitted) =>
  answer.api
    .setEnv(alice, { key: sentry, value: Redacted.make(token) })
    .pipe(Effect.orDie);

const answererReads = (answer: Admitted) =>
  Effect.gen(function* () {
    const status = yield* answer.api.status(bob);
    const verdict = yield* verdictOf(answer.api);
    const note = yield* noteOn(answer.head);
    const events = yield* answer.api.events(0, 1000);

    return JSON.stringify([
      yield* Schema.encodeEffect(Schema.toCodecJson(Schema.Array(AnswerView)))(
        status.answers
      ),
      yield* Schema.encodeEffect(Schema.toCodecJson(Schema.Option(Verdict)))(
        verdict
      ),
      yield* Schema.encodeEffect(Schema.toCodecJson(Schema.Option(Verdict)))(
        note
      ),
      yield* Schema.encodeEffect(
        Schema.toCodecJson(Schema.Array(ProjectEvent))
      )(events.map(({ event }) => event)),
    ]);
  }).pipe(Effect.orDie);

describe("a stored value where it must not be", () => {
  it.effect(
    "quarantines an answer that adds a file holding a stored value: no check runs, it never lands, and nothing its answerer reads names the item",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted(
          changed(
            fixed,
            "packages/parser/src/report.ts",
            `export const dsn = "https://${token}@sentry.io/1";\n`
          )
        );

        yield* stored(answer);
        yield* allGreen(answer.merged);

        const outcome = yield* run(answer);
        const read = yield* answererReads(answer);

        expect(outcome).toStrictEqual(
          Outcome.cases.Refused.make({ refusals: [new VerifierBlocked({})] })
        );
        expect(yield* jobsOn(answer.merged)).toStrictEqual([]);
        expect(yield* mainTip).toBe(answer.opened);
        expect(read).not.toContain(sentry);
        expect(read).not.toContain(token);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "keeps a lane log holding a stored value out of the evidence: its lane still refuses, under a withheld log, and nothing its answerer reads names the item",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();
        const unit = LaneName.make("unit");

        yield* stored(answer);
        yield* allGreen(answer.merged);
        yield* Checker.use((script) =>
          Effect.andThen(
            script.script(answer.merged, unit, [
              {
                result: "failed",
                signature: `reports: AssertionError: expected "${token}" to be redacted`,
              },
            ]),
            script.script(
              CheckAt.cases.Commit.make({ commit: answer.opened }),
              unit,
              [{ result: "passed" }]
            )
          )
        );

        const outcome = yield* run(answer);
        const puts = yield* EvidenceKept.use((kept) => kept.puts);
        const read = yield* answererReads(answer);

        expect(outcome).toStrictEqual(
          Outcome.cases.Refused.make({
            refusals: [
              new ChecksFailed({
                lane: unit,
                logRef: withheld,
                next: "bun run test",
              }),
            ],
          })
        );
        expect(puts).toStrictEqual([]);
        expect(read).not.toContain(sentry);
        expect(read).not.toContain(token);
      }).pipe(Effect.provide(sealedWorld(policy)))
  );

  it.effect(
    "writes no verdict note that would carry a stored value, on the fork or on the landed commit, and the answer lands as it would",
    () =>
      Effect.gen(function* () {
        const answer = yield* admitted();

        yield* stored(answer);
        yield* allGreen(answer.merged);

        const outcome = yield* run(answer);
        const tip = yield* mainTip;

        expect(outcome).toStrictEqual(Outcome.cases.Landed.make({ sha: tip }));
        expect(yield* noteOn(answer.head)).toStrictEqual(Option.none());
        expect(yield* noteIn(repo, tip)).toStrictEqual(Option.none());
      }).pipe(
        Effect.provide(
          sealedWorld({
            ...policy,
            run: {
              ...policy.run,
              checks: {
                ...policy.run.checks,
                [LaneName.make("unit")]: Command.make(
                  `SENTRY_AUTH_TOKEN=${token} bun run test`
                ),
              },
            },
          })
        )
      )
  );
});

const sandboxFork = RepoName.make("alice__datekit--parse-iso--bob");

const sealedJob: CheckJob = {
  at: CheckAt.cases.Tree.make({ tree: TreeSha.make("5".repeat(40)) }),
  heldBack: heldBackJob,
  lanes: [],
  placeholders: [],
  project,
  proxies: [],
  repo: sandboxFork,
  run: policy.run,
};

const allPassed: readonly HeldBackResult[] = [
  { area: exportArea, passed: 2, suite: suiteRoot, total: 2 },
  { area: parserArea, passed: 1, suite: suiteRoot, total: 1 },
];

const overSandbox = (heldBack: readonly HeldBackResult[]) =>
  Effect.gen(function* () {
    const sent: (typeof CheckWire.Encoded)[] = [];

    const exit = yield* Schema.encodeEffect(CheckExit)(
      Exit.succeed({ durationMs: 9, evidence: [], heldBack, lanes: [] })
    ).pipe(Effect.orDie);

    const sandbox = untouchable<SandboxBinding>("SANDBOX", {
      check: (wire) => {
        sent.push(wire);

        return Promise.resolve(exit);
      },
    });

    yield* RepoHost.use((host) => host.create(sandboxFork)).pipe(Effect.orDie);

    const runner = yield* Effect.service(CheckRunner).pipe(
      Effect.provide(CheckRunnerSandbox(sandbox))
    );

    return { runner, sent };
  });

describe("a held-back job through the sandbox", () => {
  it.effect(
    "sends the suite's files as base64 beside one read token on the answer's fork, and hands back its area bits",
    () =>
      Effect.gen(function* () {
        const { runner, sent } = yield* overSandbox(allPassed);
        const ran = yield* runner.run(sealedJob).pipe(Effect.orDie);
        const remote = yield* RepoHost.use((host) => host.remote(sandboxFork));

        expect(ran.heldBack).toStrictEqual(allPassed);
        expect(
          sent.map(({ clone, job }) => ({
            files: job.heldBack?.files.map(({ contentBase64, path }) => ({
              contentBase64,
              path,
            })),
            url: clone.url,
          }))
        ).toStrictEqual([
          {
            files: sealedFiles.map(({ content, path }) => ({
              contentBase64: btoa(content),
              path,
            })),
            url: remote,
          },
        ]);
        expect(JSON.stringify(sent)).not.toContain(maintainers);
      }).pipe(Effect.provide(Layer.fresh(RepoHostMemory)))
  );

  it.effect(
    "takes one bit per area from a suite that names an area twice, as the Checker counts them",
    () =>
      Effect.gen(function* () {
        const { runner } = yield* overSandbox(allPassed);

        const ran = yield* Effect.exit(
          runner.run({
            ...sealedJob,
            heldBack: {
              ...heldBackJob,
              areas: [exportArea, parserArea, exportArea],
            },
          })
        );

        expect(Exit.map(ran, ({ heldBack }) => heldBack)).toStrictEqual(
          Exit.succeed(allPassed)
        );
      }).pipe(Effect.provide(Layer.fresh(RepoHostMemory)))
  );

  it.effect(
    "refuses area bits that do not answer the job it sent: VerifierBlocked, never a bit an answer earned",
    () =>
      Effect.gen(function* () {
        const otherSuite = SuiteRoot.make(`sha256:${"0".repeat(64)}`);

        const wrong: readonly {
          readonly job: CheckJob;
          readonly bits: readonly HeldBackResult[];
        }[] = [
          { bits: allPassed.slice(0, 1), job: sealedJob },
          {
            bits: allPassed.map((each) => ({ ...each, suite: otherSuite })),
            job: sealedJob,
          },
          {
            bits: allPassed.map((each) => ({
              ...each,
              passed: each.total + 1,
            })),
            job: sealedJob,
          },
          {
            bits: allPassed.map((each) => ({ ...each, total: each.total + 1 })),
            job: sealedJob,
          },
          { bits: allPassed, job: Struct.omit(sealedJob, ["heldBack"]) },
        ];

        const outcomes = yield* Effect.forEach(wrong, ({ bits, job }) =>
          Effect.gen(function* () {
            const { runner } = yield* overSandbox(bits);

            return yield* Effect.exit(runner.run(job));
          }).pipe(Effect.provide(Layer.fresh(RepoHostMemory)))
        );

        expect(outcomes).toStrictEqual(
          wrong.map(() => Exit.fail(new VerifierBlocked({})))
        );
      })
  );
});
