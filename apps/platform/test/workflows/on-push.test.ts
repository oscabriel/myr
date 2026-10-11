import { describe, expect, it } from "@effect/vitest";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { Brand } from "@repo/brand";
import { CheckRunner } from "@repo/checks/check-runner";
import { AlarmsMemory } from "@repo/project/alarms/memory";
import { AnswerRuns } from "@repo/project/answer-runs";
import { Lander } from "@repo/project/lander";
import { projectService } from "@repo/project/project";
import type { ProjectApi } from "@repo/project/project";
import { ProjectStore } from "@repo/project/project-store";
import { ProjectStoreMemory } from "@repo/project/project-store/memory";
import { ProjectionMemory } from "@repo/project/projection/memory";
import { Projects } from "@repo/project/projects";
import { RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  ProjectExists,
  UnknownCommit,
  UnknownProject,
} from "@repo/protocol/refusal";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { advanceTo } from "@repo/testkit/clock";
import { aProject, sha, withAsk, withVouches } from "@repo/testkit/scenarios";
import { untouchable } from "@repo/testkit/untouchable";
import { DateTime, Effect, Layer, Option, Ref, Schema } from "effect";

import { RepoKind } from "../../src/repo-names.ts";
import { runInstance, runOnPush } from "../../src/workflows/on-push.ts";
import {
  classifyPush,
  PushVerdict,
} from "../../src/workflows/on-push/classify.ts";
import type {
  IgnoredReason,
  PushFacts,
} from "../../src/workflows/on-push/classify.ts";
import {
  isZero,
  OnPushEvent,
  ZeroSha,
} from "../../src/workflows/on-push/event.ts";
import { memoSteps, workflowSteps } from "../../src/workflows/step.ts";
import type { WorkflowSteps } from "../../src/workflows/step.ts";
import { fakeEnv, without } from "../fake-env.ts";

/**
 * One `cf.artifacts.repo.pushed` event as Artifacts delivered it to a spike's
 * Workflow (the first line of its recorded events), verbatim but for the
 * namespace and repo, renamed to a test project's.
 */
const deliveredLine =
  '{"id": "88018624-a405-49c4-ba41-7dc60e4a2c89", "type": "cf.artifacts.repo.pushed", "source": {"namespace": "projects-local", "repoName": "alice__datekit"}, "payload": {"ref": "refs/heads/main", "before": "cfc3cc308874a348d38c7143c9093c17a196e4af", "after": "88359ce33219db41afafbcad7adc19f4f4d84381", "commits": [{"id": "88359ce33219db41afafbcad7adc19f4f4d84381", "message": "ev-0", "messageTruncated": false, "timestamp": "2026-10-06T20:10:48.000Z", "author": {"name": "probe", "email": "probe@invalid"}, "committer": {"name": "probe", "email": "probe@invalid"}, "parents": ["cfc3cc308874a348d38c7143c9093c17a196e4af"]}], "totalCommitsCount": 1, "commitsTruncated": false}}';

/**
 * The event the same spike saw for a custom ref pushed beside `main`: its
 * `before` is git's all-zero id, since the push created the ref, and it
 * lists no commits.
 */
const createdLine =
  '{"id": "bc6f5f68-4f76-45a7-8258-ad4ffd465cae", "type": "cf.artifacts.repo.pushed", "source": {"namespace": "projects-local", "repoName": "alice__datekit"}, "payload": {"ref": "refs/asked/ev", "before": "0000000000000000000000000000000000000000", "after": "8812c641c30d4a4633c6e77e3efe52c8f029f87d", "commits": [], "totalCommitsCount": 0, "commitsTruncated": false}}';

const fromLine = Schema.decodeUnknownEffect(Schema.fromJsonString(OnPushEvent));

describe(OnPushEvent, () => {
  it.effect("decodes the push event Artifacts delivered in S1", () =>
    Effect.gen(function* () {
      const event = yield* fromLine(deliveredLine);

      expect({
        after: event.payload.after,
        before: event.payload.before,
        id: event.id,
        ref: event.payload.ref,
        repo: event.source.repoName,
        timestamps: event.payload.commits.map(({ timestamp }) => timestamp),
      }).toStrictEqual({
        after: CommitSha.make("88359ce33219db41afafbcad7adc19f4f4d84381"),
        before: CommitSha.make("cfc3cc308874a348d38c7143c9093c17a196e4af"),
        id: "88018624-a405-49c4-ba41-7dc60e4a2c89",
        ref: "refs/heads/main",
        repo: RepoName.make("alice__datekit"),
        timestamps: [DateTime.makeUnsafe("2026-10-06T20:10:48.000Z")],
      });
    })
  );

  it.effect("reads a created ref's all-zero before as git's zero id", () =>
    Effect.map(fromLine(createdLine), (event) => {
      expect([
        isZero(event.payload.before),
        isZero(event.payload.after),
        event.payload.commits,
      ]).toStrictEqual([true, false, []]);
    })
  );
});

/** The delivered event, decoded: what every other event here is made from. */
const delivered = Schema.decodeSync(Schema.fromJsonString(OnPushEvent))(
  deliveredLine
);

/** A push event like the delivered one, for `repo`'s `ref` moving to `after`. */
const pushed = (on: {
  readonly after: CommitSha;
  readonly before?: CommitSha;
  readonly id?: string;
  readonly ref?: string;
  readonly repo: string;
}): OnPushEvent => {
  const ref = on.ref ?? "refs/heads/main";

  return {
    ...delivered,
    id: on.id ?? `${on.repo} ${ref} ${on.after}`,
    payload: {
      ...delivered.payload,
      after: on.after,
      before: on.before ?? delivered.payload.before,
      ref,
    },
    source: { ...delivered.source, repoName: RepoName.make(on.repo) },
  };
};

const datekit = ProjectName.make("alice/datekit");

const parseIso = AskId.make("parse-iso");

const mainText = RefNameText.make("refs/heads/main");

const landedSha = sha("datekit:landed");

const strayHead = sha("datekit:stray");

const answerHead = sha("datekit:answer");

const canonical = RepoKind.Canonical({ project: datekit });

const bobsFork = RepoKind.ClaimFork({
  ask: parseIso,
  handle: Handle.make("bob"),
  project: datekit,
});

/** What the DO said: nothing landed, nothing seen, unless a row says so. */
const facts = (repo: RepoKind, more: Partial<PushFacts> = {}): PushFacts => ({
  landed: new Set(),
  repo,
  seen: false,
  ...more,
});

const ignored = (reason: IgnoredReason) =>
  PushVerdict.cases.Ignored.make({ reason });

const table: readonly {
  readonly title: string;
  readonly event: OnPushEvent;
  readonly facts: PushFacts;
  readonly verdict: PushVerdict;
}[] = [
  {
    event: pushed({ after: landedSha, repo: "alice__datekit" }),
    facts: facts(canonical, { landed: new Set([landedSha]) }),
    title: "canonical main moved to a commit the platform landed",
    verdict: ignored("own landing"),
  },
  {
    event: pushed({
      after: landedSha,
      ref: `${Brand.refsPrefix}landed`,
      repo: "alice__datekit",
    }),
    facts: facts(canonical),
    title: "the landed mirror moved",
    verdict: ignored("bookkeeping ref"),
  },
  {
    event: pushed({
      after: strayHead,
      ref: `refs/notes/${Brand.slug}`,
      repo: "alice__datekit",
    }),
    facts: facts(canonical),
    title: "the verdict notes moved",
    verdict: ignored("bookkeeping ref"),
  },
  {
    event: pushed({
      after: strayHead,
      ref: `${Brand.refsPrefix}compose/${"e".repeat(40)}`,
      repo: "alice__datekit",
    }),
    facts: facts(canonical),
    title: "a composed commit was parked under the platform's prefix",
    verdict: ignored("bookkeeping ref"),
  },
  {
    event: pushed({
      after: strayHead,
      ref: "refs/heads/release",
      repo: "alice__datekit",
    }),
    facts: facts(canonical),
    title: "a canonical branch other than main moved",
    verdict: ignored("not main"),
  },
  {
    event: pushed({
      after: strayHead,
      before: landedSha,
      repo: "alice__datekit",
    }),
    facts: facts(canonical, { landed: new Set([landedSha]) }),
    title: "canonical main moved to a commit no landing made",
    verdict: PushVerdict.cases.Stray.make({
      after: strayHead,
      before: landedSha,
      project: datekit,
      ref: mainText,
    }),
  },
  {
    event: pushed({
      after: ZeroSha,
      before: landedSha,
      repo: "alice__datekit",
    }),
    facts: facts(canonical, { landed: new Set([landedSha]) }),
    title: "canonical main was deleted",
    verdict: PushVerdict.cases.Stray.make({
      after: ZeroSha,
      before: landedSha,
      project: datekit,
      ref: mainText,
    }),
  },
  {
    event: pushed({
      after: answerHead,
      repo: "alice__datekit--parse-iso--bob",
    }),
    facts: facts(bobsFork, { seen: true }),
    title: "a claim fork took a push the gateway recorded",
    verdict: ignored("seen"),
  },
  {
    event: pushed({
      after: answerHead,
      repo: "alice__datekit--parse-iso--bob",
    }),
    facts: facts(bobsFork),
    title: "a claim fork took a push the gateway never recorded",
    verdict: PushVerdict.cases.ForkPush.make({
      ask: parseIso,
      head: answerHead,
      project: datekit,
    }),
  },
  {
    event: pushed({
      after: answerHead,
      ref: `refs/notes/${Brand.slug}`,
      repo: "alice__datekit--parse-iso--bob",
    }),
    facts: facts(bobsFork),
    title: "a claim fork's verdict notes moved",
    verdict: ignored("bookkeeping ref"),
  },
  {
    event: pushed({
      after: ZeroSha,
      before: answerHead,
      repo: "alice__datekit--parse-iso--bob",
    }),
    facts: facts(bobsFork),
    title: "a claim fork's branch was deleted",
    verdict: ignored("deleted ref"),
  },
  {
    event: pushed({ after: answerHead, repo: "alice__datekit--me--alice" }),
    facts: facts(
      RepoKind.WorkingFork({ handle: Handle.make("alice"), project: datekit })
    ),
    title: "a decider's working fork took a push",
    verdict: ignored("not main"),
  },
  {
    event: pushed({ after: strayHead, repo: "Not.A.Project" }),
    facts: facts(RepoKind.Unknown()),
    title: "a repo no project has",
    verdict: ignored("unknown repo"),
  },
];

describe(classifyPush, () => {
  it.each(table)("$title", ({ event, facts: said, verdict }) => {
    expect(classifyPush(event, said)).toStrictEqual(verdict);
  });
});

/**
 * datekit at its landed commit, which the platform landed on top of its
 * first: alice decides everything, bob is vouched for, and `parse-iso` is
 * open.
 */
const scenario = aProject({ people: ["bob"] }).pipe(
  withVouches(["bob"]),
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const alice = Person.make({ handle: scenario.initializer });

const bob = Person.make({ handle: Handle.make("bob") });

/** The project's one landing: its landed commit. */
const theLanding: LandingView = {
  assisted: [],
  author: scenario.initializer,
  credits: [],
  landedAt: scenario.now,
  parent: LandedSha.make(sha("datekit:start")),
  project: datekit,
  sha: scenario.landed,
};

/**
 * Every port the project's service runs on, in memory. The Lander, the
 * Checker, the rules and answer runs are never needed by a push event:
 * touching one fails the test.
 */
const ports = Layer.mergeAll(
  AlarmsMemory,
  ProjectionMemory,
  ProjectStoreMemory,
  RepoHostMemory,
  Layer.succeed(
    AnswerRuns,
    untouchable<typeof AnswerRuns.Service>("AnswerRuns")
  ),
  Layer.succeed(
    CheckRunner,
    untouchable<typeof CheckRunner.Service>("CheckRunner")
  ),
  Layer.succeed(Lander, untouchable<typeof Lander.Service>("Lander")),
  Layer.succeed(
    RulesEvaluator,
    untouchable<typeof RulesEvaluator.Service>("RulesEvaluator")
  )
);

/** datekit live at its landed commit, with its one landing and its asks, as its store holds them. */
const seeded = Effect.gen(function* () {
  const store = yield* ProjectStore;

  const policy = yield* Schema.encodeEffect(Schema.toCodecJson(Policy))(
    scenario.policy
  );

  yield* store.commit({
    asks: scenario.policy.asks,
    landings: [theLanding],
    project: {
      createdAt: scenario.now,
      initializer: scenario.initializer,
      landed: scenario.landed,
      policy,
      policyAt: scenario.landed,
      project: datekit,
      state: "live",
    },
  });
});

/** `Projects` in memory, holding datekit's service and no other project. */
const projectsOf = (api: ProjectApi) =>
  Layer.succeed(
    Projects,
    Projects.of({
      create: (project) => Effect.fail(new ProjectExists({ project })),
      get: (project) =>
        project === datekit
          ? Effect.succeed(api)
          : Effect.fail(new UnknownProject({ project })),
    })
  );

/** datekit's service over its seeded store, and `Projects` holding it, at noon. */
const world = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");
  yield* seeded;

  const api = yield* projectService(datekit);

  return { api, projects: projectsOf(api), store: yield* ProjectStore };
}).pipe(Effect.provide(ports));

/** OnPush's program over `event`, with a fresh record of steps. */
const onPush = (event: OnPushEvent, projects: Layer.Layer<Projects>) =>
  Effect.flatMap(memoSteps(), (steps) =>
    runOnPush(event).pipe(Effect.provide([steps, projects]))
  );

/** `Projects` holding `api`, and the id of every push event the DO is told of. */
const telling = (api: ProjectApi) =>
  Effect.map(Ref.make<readonly string[]>([]), (told) => ({
    projects: projectsOf({
      ...api,
      recordPush: (report) =>
        Effect.andThen(
          Ref.update(told, (ids) => [...ids, report.eventId]),
          api.recordPush(report)
        ),
    }),
    told,
  }));

/**
 * A Workflow engine's steps in memory, as the engine keeps them: each runs
 * once, and what it ended with, its JSON or its failure, is kept by name and
 * handed to a replay without running it again.
 */
const engineSteps = () => {
  const recorded = new Map<string, Promise<Schema.Json>>();

  const steps: WorkflowSteps = {
    do: (name, _config, body) => {
      const kept = recorded.get(name) ?? body();

      recorded.set(name, kept);

      return kept;
    },
  };

  return { recorded, steps };
};

describe(runOnPush, () => {
  it.effect(
    "ignores main moved to the landing the platform made, and its bookkeeping refs",
    () =>
      Effect.gen(function* () {
        const { api, projects } = yield* world;

        const verdicts = yield* Effect.forEach(
          [
            pushed({ after: scenario.landed, repo: "alice__datekit" }),
            pushed({
              after: scenario.landed,
              ref: `${Brand.refsPrefix}landed`,
              repo: "alice__datekit",
            }),
            pushed({
              after: strayHead,
              ref: `refs/notes/${Brand.slug}`,
              repo: "alice__datekit",
            }),
          ],
          (event) => onPush(event, projects)
        );

        expect(verdicts).toStrictEqual([
          ignored("own landing"),
          ignored("bookkeeping ref"),
          ignored("bookkeeping ref"),
        ]);
        expect((yield* api.today(alice)).decisions).toStrictEqual([]);
      })
  );

  it.effect(
    "ignores a claim fork's push the gateway recorded, and records one it never saw as the claimant's",
    () =>
      Effect.gen(function* () {
        const { api, projects } = yield* world;
        const fork = "alice__datekit--parse-iso--bob";
        const elsewhere = sha("datekit:elsewhere");

        /** When bob's claim last heard a push, as he sees it. */
        const lastPush = Effect.map(api.status(bob), ({ claims }) =>
          claims.map(({ lastPushAt }) =>
            Option.map(Option.fromUndefinedOr(lastPushAt), DateTime.formatIso)
          )
        );

        yield* api.claim(bob, parseIso);

        // The gateway forwarded bob's push and recorded it.
        yield* advanceTo("2026-10-07T13:00:00Z");
        yield* api.recordPush({
          after: answerHead,
          before: Option.none(),
          eventId: `push-${answerHead}`,
          pusher: bob,
          ref: "refs/heads/main",
          repo: RepoName.make(fork),
        });

        yield* advanceTo("2026-10-07T13:30:00Z");

        const seen = yield* onPush(
          pushed({ after: answerHead, repo: fork }),
          projects
        );

        const afterSeen = yield* lastPush;

        // A commit that reached the fork without passing the gateway.
        yield* advanceTo("2026-10-07T14:00:00Z");

        const unseen = yield* onPush(
          pushed({ after: elsewhere, before: answerHead, repo: fork }),
          projects
        );

        expect([seen, unseen]).toStrictEqual([
          ignored("seen"),
          PushVerdict.cases.ForkPush.make({
            ask: parseIso,
            head: elsewhere,
            project: datekit,
          }),
        ]);
        expect([afterSeen, yield* lastPush]).toStrictEqual([
          [Option.some("2026-10-07T13:00:00.000Z")],
          [Option.some("2026-10-07T14:00:00.000Z")],
        ]);
        expect((yield* api.today(alice)).decisions).toStrictEqual([]);
      })
  );

  it.effect(
    "opens a StrayPush decision on Today, revert by default, when main moved without a landing",
    () =>
      Effect.gen(function* () {
        const { api, projects } = yield* world;

        const verdict = yield* onPush(
          pushed({
            after: strayHead,
            before: scenario.landed,
            repo: "alice__datekit",
          }),
          projects
        );

        const { decisions } = yield* api.today(alice);

        expect(verdict).toStrictEqual(
          PushVerdict.cases.Stray.make({
            after: strayHead,
            before: scenario.landed,
            project: datekit,
            ref: mainText,
          })
        );
        expect(
          decisions.map((decision) => ({
            default: decision.default,
            subject: decision.subject,
          }))
        ).toStrictEqual([
          {
            default: "revert",
            subject: DecisionSubject.cases.StrayPush.make({
              after: strayHead,
              before: scenario.landed,
              ref: mainText,
            }),
          },
        ]);
      })
  );

  it.effect(
    "opens one decision for one event, replayed over one record of steps or recorded twice",
    () =>
      Effect.gen(function* () {
        const { api } = yield* world;
        const { projects, told } = yield* telling(api);

        const stray = pushed({
          after: strayHead,
          before: scenario.landed,
          id: "2027e2b8-96df-4364-a992-3be1b702d7f4",
          repo: "alice__datekit",
        });

        const steps = yield* memoSteps();

        const replayed = runOnPush(stray).pipe(
          Effect.provide([steps, projects])
        );

        // The same instance replayed, then the same event in a second instance.
        const verdicts = [
          yield* replayed,
          yield* replayed,
          yield* onPush(stray, projects),
        ];

        const { decisions } = yield* api.today(alice);

        expect(verdicts.map(({ _tag }) => _tag)).toStrictEqual([
          "Stray",
          "Stray",
          "Stray",
        ]);
        expect(yield* Ref.get(told)).toStrictEqual([stray.id, stray.id]);
        expect(decisions.map(({ subject }) => subject)).toStrictEqual([
          DecisionSubject.cases.StrayPush.make({
            after: strayHead,
            before: scenario.landed,
            ref: mainText,
          }),
        ]);
      })
  );

  it.effect(
    "settles a stray main as a recorded value, so a run the engine replays after keeping the grace's failure still opens one decision",
    () =>
      Effect.gen(function* () {
        const { api } = yield* world;
        const { projects, told } = yield* telling(api);
        const engine = engineSteps();

        const stray = pushed({
          after: strayHead,
          before: scenario.landed,
          repo: "alice__datekit",
        });

        // The instance's run, then the same run replayed by the engine.
        const run = runOnPush(stray).pipe(
          Effect.provide([workflowSteps(engine.steps), projects]),
          Effect.catchDefect(() => Effect.succeed("died"))
        );

        const verdicts = [yield* run, yield* run];
        const { decisions } = yield* api.today(alice);

        const verdict = PushVerdict.cases.Stray.make({
          after: strayHead,
          before: scenario.landed,
          project: datekit,
          ref: mainText,
        });

        expect({
          decisions: decisions.map(({ subject }) => subject._tag),
          steps: [...engine.recorded.keys()],
          told: yield* Ref.get(told),
          verdicts,
        }).toStrictEqual({
          decisions: ["StrayPush"],
          steps: ["classify", "settle", "record"],
          told: [stray.id],
          verdicts: [verdict, verdict],
        });
      })
  );

  it.effect(
    "asks again before calling main stray, so a landing the DO records a moment late is its own",
    () =>
      Effect.gen(function* () {
        const { api, store } = yield* world;
        const asked = yield* Ref.make(0);

        // The platform pushed main; its DO records the landing just after the first ask.
        const late = Projects.of({
          create: (project) => Effect.fail(new ProjectExists({ project })),
          get: () =>
            Effect.succeed({
              ...api,
              landing: (caller, at) =>
                Effect.flatMap(
                  Ref.getAndUpdate(asked, (n) => n + 1),
                  (n) =>
                    n === 0
                      ? Effect.andThen(
                          store.commit({
                            landings: [
                              {
                                ...theLanding,
                                parent: scenario.landed,
                                sha: LandedSha.make(strayHead),
                              },
                            ],
                          }),
                          Effect.fail(new UnknownCommit({ sha: at }))
                        )
                      : api.landing(caller, at)
                ),
            }),
        });

        const verdict = yield* onPush(
          pushed({
            after: strayHead,
            before: scenario.landed,
            repo: "alice__datekit",
          }),
          Layer.succeed(Projects, late)
        );

        expect([verdict, yield* Ref.get(asked)]).toStrictEqual([
          ignored("own landing"),
          2,
        ]);
        expect((yield* api.today(alice)).decisions).toStrictEqual([]);
      })
  );

  it.effect(
    "calls a deleted main stray at once: no landing is in flight to wait for",
    () =>
      Effect.gen(function* () {
        const { api, projects } = yield* world;
        const engine = engineSteps();

        const verdict = yield* runOnPush(
          pushed({
            after: ZeroSha,
            before: scenario.landed,
            repo: "alice__datekit",
          })
        ).pipe(Effect.provide([workflowSteps(engine.steps), projects]));

        const { decisions } = yield* api.today(alice);

        expect({
          decisions: decisions.map(({ subject }) => subject),
          steps: [...engine.recorded.keys()],
          verdict,
        }).toStrictEqual({
          decisions: [
            DecisionSubject.cases.StrayPush.make({
              after: ZeroSha,
              before: scenario.landed,
              ref: mainText,
            }),
          ],
          steps: ["classify", "record"],
          verdict: PushVerdict.cases.Stray.make({
            after: ZeroSha,
            before: scenario.landed,
            project: datekit,
            ref: mainText,
          }),
        });
      })
  );

  it.effect("ignores a repo whose name no project of the platform's has", () =>
    Effect.gen(function* () {
      const { projects } = yield* world;

      const verdicts = yield* Effect.forEach(
        ["Not.A.Project", "alice__datekit--parse-iso", "elsewhere"],
        (repo) => onPush(pushed({ after: strayHead, repo }), projects)
      );

      expect(verdicts).toStrictEqual([
        ignored("unknown repo"),
        ignored("unknown repo"),
        ignored("unknown repo"),
      ]);
    })
  );
});

/** The delivered event as the engine hands it to an instance: its params. */
const sent = Schema.encodeSync(OnPushEvent)(delivered);

describe(runInstance, () => {
  it.effect("decodes its params before it reads the env", () =>
    Effect.gen(function* () {
      // A ref name where a commit id belongs, and an env missing its stage.
      const failure = yield* runInstance(
        without(fakeEnv(), "STAGE"),
        { ...sent, payload: { ...sent.payload, after: "HEAD" } },
        engineSteps().steps
      ).pipe(Effect.flip);

      expect(failure._tag).toBe("SchemaError");
    })
  );

  it.effect(
    "answers a repo no project has without touching a binding, and records its step as JSON",
    () =>
      Effect.gen(function* () {
        const engine = engineSteps();

        const output = yield* runInstance(
          fakeEnv(),
          { ...sent, source: { ...sent.source, repoName: "Not.A.Project" } },
          engine.steps
        );

        const expected = yield* Schema.encodeEffect(PushVerdict)(
          ignored("unknown repo")
        );

        expect([
          output,
          yield* Effect.promise(
            () => engine.recorded.get("classify") ?? Promise.resolve(null)
          ),
          [...engine.recorded.keys()],
        ]).toStrictEqual([expected, expected, ["classify"]]);
      })
  );
});
