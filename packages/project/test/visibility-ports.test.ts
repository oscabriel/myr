/**
 * The project service through its visibility ports (W6 609): with
 * recording fakes of `ProjectVisibility` and `ProjectEnv` provided, every
 * delegation reaches the port, sees the project as the call has it, and
 * the service commits what the port plans: a landing's policy plan (its
 * ledger rows, and its effect settled after the commit), the suite pinned at
 * claim, the layer paths stage 1 refuses, a held-back judgement judged once
 * per tree with its trailer on the landing, layer reads and pushes, and
 * write-only values. Group A and B issues build the real ports to these
 * seams.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { parseTrailers } from "@repo/git/trailers";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import { CheckSpec } from "@repo/protocol/domain/check";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AreaName,
  CommitSha,
  EnvKey,
  LaneName,
  LayerName,
  RepoName,
  RepoPath,
  RequestId,
  SuiteRoot,
} from "@repo/protocol/ids";
import { Anonymous, Person, Principal } from "@repo/protocol/principal";
import { advanceTo } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import { Array, Effect, Layer, Option, Redacted } from "effect";

import { AnswerRuns } from "../src/answer-runs.ts";
import { drive, isStep, nextSteps, runStep } from "../src/answer-runs/steps.ts";
import { noEnv, ProjectEnv } from "../src/env-port.ts";
import type { EnvPort } from "../src/env-port.ts";
import { LandingState } from "../src/landing.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectSnapshot } from "../src/project-store.ts";
import { projectService } from "../src/project.ts";
import { noVisibility, ProjectVisibility } from "../src/visibility-port.ts";
import type {
  PinnedClaim,
  VisibilityEffect,
  VisibilityPort,
} from "../src/visibility-port.ts";
import { CheckScript, composedAt, mergedAt, Pusher, worldOf } from "./world.ts";

const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const { project } = scenario;

const repo = RepoName.make(project);

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({
  handle: scenario.people.get("bob") ?? scenario.initializer,
});

const anyone = Anonymous.make({});

const maintainers = LayerName.make("maintainers");

const exportArea = AreaName.make("export");

/** The suite the fake pins every claim to. */
const pinned = {
  at: CommitSha.make("e".repeat(40)),
  suite: SuiteRoot.make(`sha256:${"3f".repeat(32)}`),
};

/** A path the fake's layer holds: no public tree may carry it. */
const sealedPath = RepoPath.make("checks/held-back/export/escape.test.ts");

const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
];

const parseIso = Option.getOrThrow(
  Array.findFirst(scenario.policy.asks, (ask) => ask.id === "parse-iso")
);

/** The ask's own files: its file in the config folder, and its check. */
const askFiles = Array.make(
  { content: 'export default "parse-iso";\n', path: parseIso.file },
  {
    content: [
      'import { expect, it } from "vitest";',
      'import { parser } from "../src/parser.ts";',
      "",
      'it("parse-iso", () => {',
      '  expect(parser(" 2026 ")).toStrictEqual("2026");',
      "});",
      "",
    ].join("\n"),
    path: CheckSpec.guards.RedThenGreen(parseIso.check)
      ? parseIso.check.path
      : RepoPath.make(`${Brand.configDir}/checks/parse-iso.test.ts`),
  }
);

const redThenGreen = LaneName.make("redThenGreen");

const lanes = [redThenGreen, LaneName.make("lint"), LaneName.make("types")];

/** What the fakes were asked, in order. */
interface Seen {
  readonly judged: PinnedClaim[];
  readonly landedEnv: string[];
  readonly policies: number[];
  readonly settled: VisibilityEffect[];
}

/**
 * A visibility port that pins every claim to `pinned`, holds `sealedPath`
 * in a layer alice reads, judges every held-back run a pass with a trailer,
 * declares the maintainers layer in the ledger at each policy it hears,
 * and plans one effect it then settles.
 */
const fakeVisibility = (seen: Seen): VisibilityPort => ({
  ...noVisibility,
  access: (who, layer) =>
    layer === maintainers
      ? Option.some(Principal.guards.Person(who) ? "read" : "none")
      : Option.none(),
  heldBackJob: (claim) =>
    Effect.succeed(
      Option.some({
        areas: [exportArea],
        at: claim.pinned.at,
        files: [],
        runs: [],
        suite: claim.pinned.suite,
      })
    ),
  judgeHeldBack: (input) => {
    seen.judged.push(input);

    return {
      refusals: [],
      trailer: Option.some(`export 1/1 @ ${input.pinned.suite}`),
      writes: {
        attempts: [
          {
            area: exportArea,
            ask: input.ask,
            claimant: input.claimant,
            count: 0,
            week: "2026-W41",
          },
        ],
      },
    };
  },
  layerPaths: () => Effect.succeed(new Set([sealedPath])),
  ledger: (named, snapshot) => ({
    entries: snapshot.ledger,
    layers: [],
    posture: "open",
    postureLabel: "Open",
    project: named,
  }),
  onLayerPush: (input) =>
    Effect.succeed({
      effects: [],
      writes: {
        layers: [
          {
            name: input.layer,
            proposed: input.head,
            repo: RepoName.make(`${project}--${input.layer}`),
          },
        ],
      },
    }),
  onPolicy: (input, snapshot) =>
    Effect.sync(() => {
      seen.policies.push(input.landings.length);

      return {
        effects: [
          { body: { layer: maintainers }, id: "provision-maintainers" },
        ],
        writes: {
          // The layer the project keeps a repo for, as the real port writes it.
          layers: [
            {
              name: maintainers,
              repo: RepoName.make(`${project}--${maintainers}`),
            },
          ],
          ledger: [
            LedgerEntry.cases.LayerDeclared.make({
              at: input.now,
              disclose: "sealed",
              kinds: ["checks"],
              layer: maintainers,
              seq: snapshot.ledger.length + 1,
            }),
          ],
        },
      };
    }),
  pinSuite: () => Option.some(pinned),
  readableLayers: (who) =>
    Principal.guards.Person(who) && who.handle === alice.handle
      ? new Set([maintainers])
      : new Set(),
  recordRead: (input) => ({
    layerReads: [
      {
        at: input.at,
        handle: input.handle,
        layer: input.layer,
        ...Option.match(input.sha, {
          onNone: () => ({}),
          onSome: (sha) => ({ sha }),
        }),
      },
    ],
  }),
  settle: (effect) =>
    Effect.sync(() => {
      seen.settled.push(effect);

      return true;
    }),
});

/** An env port that takes any value for any key a decider sets, and hears each landing. */
const fakeEnv = (seen: Seen): EnvPort => ({
  ...noEnv,
  onLanded: (input) =>
    Effect.sync(() => {
      seen.landedEnv.push(input.after);

      return { effects: [], writes: {} };
    }),
  set: (input) =>
    Effect.succeed({
      result: { key: input.key, setAt: input.now, setBy: input.by.handle },
      writes: {
        envValues: [
          {
            key: input.key,
            sealed: { sealedWith: "the fake" },
            setAt: input.now,
            setBy: input.by.handle,
          },
        ],
      },
    }),
});

/** The world, with answer runs left to the test and the fakes plugged in. */
const worldWith = (seen: Seen) =>
  Layer.mergeAll(
    worldOf(scenario, "memory"),
    Layer.succeed(AnswerRuns, AnswerRuns.of({ start: () => Effect.void })),
    Layer.succeed(ProjectVisibility, fakeVisibility(seen)),
    Layer.succeed(ProjectEnv, fakeEnv(seen))
  );

const fresh = (): Seen => ({
  judged: [],
  landedEnv: [],
  policies: [],
  settled: [],
});

/** alice makes datekit, opens `parse-iso`, and bob claims it. */
const claimed = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const api = yield* projectService(project);

  yield* api.initProject(alice, {});

  const first = yield* Pusher.use((pusher) =>
    pusher.push(repo, Option.none(), start, "Start")
  );

  const { landed } = yield* api.recordFirstPush(alice, first);
  const composed = yield* composedAt(repo, landed, askFiles);

  yield* CheckScript.use((checker) =>
    checker.script(composed, redThenGreen, ["failed", "failed"])
  );

  const opened = yield* api.openAsk(alice, {
    ask: parseIso.id,
    files: askFiles,
  });

  const { claim } = yield* api.claim(bob, parseIso.id);

  return { api, claim, main: opened.landed };
});

/** The project's rows as its store keeps them. */
const stored: Effect.Effect<ProjectSnapshot, never, ProjectStore> =
  ProjectStore.use((store) => store.load());

/** The files bob's answer holds: main's, with the parser fixed. */
const answerFiles: Files = [
  ...start,
  ...askFiles.map(({ content, path }) => [path, content] as const),
  ["packages/parser/src/parse.ts", "export const parse = (s) => s;\n"],
];

/** bob's answer, pushed and submitted, and its merge reported: its checks wait. */
const merged = (input: Effect.Success<typeof claimed>) =>
  Effect.gen(function* () {
    const { api } = input;

    const head = yield* Pusher.use((pusher) =>
      pusher.push(input.claim.fork, Option.some(input.main), answerFiles)
    );

    const requestId = RequestId.make("req-parse-iso");

    yield* api.submitAnswer(bob, {
      ask: parseIso.id,
      base: input.main,
      head,
      requestId,
    });

    const tree = yield* mergedAt({
      base: input.main,
      fork: input.claim.fork,
      head,
      main: input.main,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(lanes, (lane) => checker.script(tree, lane, ["passed"]), {
        discard: true,
      })
    );

    const run = Option.getOrThrow(yield* api.answer(requestId));
    const merge = Option.getOrThrow(Array.findFirst(nextSteps(run), isStep));
    const reported = Option.getOrThrow(yield* runStep(run, merge));

    yield* api.advanceAnswer(requestId, reported.command, reported.report);

    return { head, requestId };
  });

/** The area bits of a held-back run that passed. */
const passed: readonly HeldBackResult[] = [
  { area: exportArea, passed: 1, suite: pinned.suite, total: 1 },
];

describe("the project service through its visibility ports", () => {
  it.effect(
    "hears each landing's policy and env, commits the plan's rows with it, and settles its effect after",
    () => {
      const seen = fresh();

      return Effect.gen(function* () {
        const { api } = yield* claimed;
        const { entries } = yield* api.ledger(anyone);

        expect({
          entries: entries.map(({ _tag, seq }) => `${seq} ${_tag}`),
          landedEnv: seen.landedEnv.length,
          policies: seen.policies,
          settled: seen.settled.map(({ id }) => id),
        }).toStrictEqual({
          entries: ["1 LayerDeclared", "2 LayerDeclared"],
          landedEnv: 2,
          policies: [1, 1],
          settled: ["provision-maintainers", "provision-maintainers"],
        });
      }).pipe(Effect.provide(worldWith(seen)));
    }
  );

  it.effect(
    "pins a claim to the suite sealed when it opened, and shows it to its claimant",
    () =>
      Effect.gen(function* () {
        const { api, claim } = yield* claimed;
        const status = yield* api.status(bob);
        const rows = (yield* stored).claims;

        expect({
          claimed: claim.suite,
          row: rows.map((row) => row.pinned),
          status: status.claims.map(({ suite }) => suite),
        }).toStrictEqual({
          claimed: pinned.suite,
          row: [pinned],
          status: [pinned.suite],
        });
      }).pipe(Effect.provide(worldWith(fresh())))
  );

  it.effect(
    "refuses a push that adds a layer's path at stage 1, from the port's layer paths",
    () =>
      Effect.gen(function* () {
        const { api, claim, main } = yield* claimed;

        const head = yield* Pusher.use((pusher) =>
          pusher.push(claim.fork, Option.some(main), [
            ...answerFiles,
            [sealedPath, "it('escapes', () => {});\n"],
          ])
        );

        const refusals = yield* api.recordPush({
          after: head,
          before: Option.some(main),
          eventId: "push-sealed",
          pusher: bob,
          ref: "refs/heads/main",
          repo: claim.fork,
        });

        expect({
          alice: yield* api.layerFacts(alice),
          bob: yield* api.layerFacts(bob),
          refused: refusals.map(({ _tag }) => _tag),
        }).toStrictEqual({
          alice: { canRead: true, layerPaths: [sealedPath] },
          bob: { canRead: false, layerPaths: [sealedPath] },
          // Outside the ask's territory too: stage 1 says both at once.
          refused: ["OutOfScope", "PrivatePathInPublicTree"],
        });
      }).pipe(Effect.provide(worldWith(fresh())))
  );

  it.effect(
    "judges a held-back run once per tree, and lands the answer with its trailer",
    () => {
      const seen = fresh();

      return Effect.gen(function* () {
        const input = yield* claimed;
        const { api } = input;
        const { requestId } = yield* merged(input);
        const job = yield* api.heldBackJob(requestId);
        const first = yield* api.recordHeldBack(requestId, passed);
        const again = yield* api.recordHeldBack(requestId, passed);

        yield* drive(api, requestId);

        const run = Option.getOrThrow(yield* api.answer(requestId));

        const sha = yield* Effect.fromOption(
          Option.liftPredicate(run.state, LandingState.guards.Landed)
        ).pipe(
          Effect.map(({ sha: landed }) => landed),
          Effect.orDie
        );

        const host = yield* RepoHost;

        const commit = Option.getOrThrow(
          yield* host.readCommit(repo, sha).pipe(Effect.orDie)
        );

        const { landing } = yield* api.landing(anyone, sha);

        expect({
          attempts: (yield* stored).attempts.length,
          judged: seen.judged.map(({ pinned: suite }) => suite),
          refusals: [first, again],
          suite: Option.map(job, ({ suite }) => suite),
          trailer: landing.heldBackTrailer,
        }).toStrictEqual({
          attempts: 1,
          judged: [pinned],
          refusals: [[], []],
          suite: Option.some(pinned.suite),
          // The trailer's value: every reader adds its key.
          trailer: `export 1/1 @ ${pinned.suite}`,
        });
        expect(
          parseTrailers(commit.message).filter(({ key }) => key === "Held-back")
        ).toStrictEqual([
          { key: "Held-back", value: `export 1/1 @ ${pinned.suite}` },
        ]);
      }).pipe(Effect.provide(worldWith(seen)));
    }
  );

  it.effect(
    "keeps the layer reads, layer pushes and write-only values the ports plan",
    () =>
      Effect.gen(function* () {
        const { api, main } = yield* claimed;

        yield* api.recordLayerRead(alice, { layer: maintainers, sha: main });
        yield* api.recordLayerPush(alice, { head: main, layer: maintainers });

        const set = yield* api.setEnv(alice, {
          key: EnvKey.make("SENTRY_AUTH_TOKEN"),
          value: Redacted.make("a-value-long-enough-0123"),
        });

        const rows = yield* stored;

        const reads = yield* ProjectStore.use((store) =>
          store.layerReadsSince(0, 10)
        );

        expect({
          access: [
            yield* api.layerAccess(alice, maintainers),
            yield* api.layerAccess(alice, LayerName.make("security")),
          ],
          layers: rows.layers.map(({ name, proposed }) => [name, proposed]),
          reads: reads.map(({ handle, layer, seq }) => [seq, handle, layer]),
          set: [set.key, set.setBy],
          values: rows.envValues.map(({ key, setBy }) => [key, setBy]),
        }).toStrictEqual({
          access: [Option.some("read"), Option.none()],
          layers: [[maintainers, main]],
          reads: [[1, alice.handle, maintainers]],
          set: ["SENTRY_AUTH_TOKEN", alice.handle],
          values: [["SENTRY_AUTH_TOKEN", alice.handle]],
        });
      }).pipe(Effect.provide(worldWith(fresh())))
  );
});
