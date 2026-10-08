import { describe, expect, it } from "@effect/vitest";
import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { shaOf } from "@repo/checks/check-runner";
import { authorLine, committerLine, parseTrailers } from "@repo/git/trailers";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { Glob, RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  LaneName,
  ProjectName,
  ProposalId,
  RepoName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import {
  CapReached,
  DecisionClosed,
  Denounced,
  NotDecider,
  NotVouched,
  TouchedJudge,
  UnknownAsk,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import { RulesEvaluator } from "@repo/rules/rules-evaluator";
import { parseVouchFile } from "@repo/rules/vouch";
import { advanceTo, at as instant } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import {
  aProject,
  withAsk,
  withKind,
  withVouches,
} from "@repo/testkit/scenarios";
import { Array, DateTime, Effect, Exit, Layer, Option, Result } from "effect";

import { ScheduledAlarm } from "../src/alarms/memory.ts";
import { platformHandle } from "../src/attention/effects.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectApi } from "../src/project.ts";
import { projectService } from "../src/project.ts";
import { creditsFor, Projects } from "../src/projects.ts";
import { ProjectsMemory } from "../src/projects/memory.ts";
import { CheckScript, composedAt, mergedAt, Pusher, worldOf } from "./world.ts";

const people = ["bob", "carol", "dave", "erin", "eve", "frank"];

/**
 * datekit, whose deciders are alice alone (`**`). Everyone but dave is
 * vouched for. `format-date` is a `polish` ask, whose kind needs a finish.
 */
const scenario = aProject({ people }).pipe(
  withVouches(["bob", "carol", "erin", "eve", "frank"]),
  withKind({
    checkKind: "redThenGreen",
    claimers: "vouched",
    finish: "required",
    name: "polish",
    oneWay: false,
    race: 1,
    requires: ["want", "check", "territory"],
    strength: "assertion",
  }),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "packages/trim" }),
  withAsk({ id: "lex-tokens", territory: "packages/lexer" }),
  withAsk({ id: "format-date", kind: "polish", territory: "packages/format" })
);

const { project } = scenario;

const repo = RepoName.make(project);

const mainRef = RefName.make("refs/heads/main");

const person = (name: string) =>
  Person.make({ handle: scenario.people.get(name) ?? scenario.initializer });

const alice = person("alice");

/** alice, as a sign-in provider that capitalizes handles names her. */
const aliceSignedIn = Person.make({ handle: Handle.make("Alice") });

const bob = person("bob");

const carol = person("carol");

const dave = person("dave");

const erin = person("erin");

const eve = person("eve");

const frank = person("frank");

const anyone = Anonymous.make({});

const userOf = (handle: string) =>
  `${handle} <${handle}@users.${Brand.domain}>`;

const askOf = (id: string): Ask =>
  Option.getOrThrow(
    Array.findFirst(scenario.policy.asks, (ask) => ask.id === id)
  );

const redThenGreen = LaneName.make("redThenGreen");

const noon = instant("2026-10-07T12:00:00Z");

const daysAfter = (from: DateTime.Utc, count: number) =>
  DateTime.add(from, { days: count });

/** The project as alice first pushes it. */
const start: Files = [
  ["package.json", '{ "name": "datekit", "workspaces": ["packages/*"] }\n'],
  [
    "packages/format/src/format.ts",
    "export const format = (d) => String(d);\n",
  ],
  ["packages/lexer/src/lex.ts", "export const lex = (s) => s.split(' ');\n"],
  ["packages/parser/src/parse.ts", "export const parse = (s) => ({});\n"],
  ["packages/trim/src/trim.ts", "export const trim = (s) => s;\n"],
];

/** An ask's own files: its file in the config folder, and its check. */
const askFiles = (id: string) => {
  const { check, file, territory } = askOf(id);

  const subject = territory.module;

  return Array.make(
    { content: `export default "${id}";\n`, path: file },
    {
      content: [
        `import { expect, it } from "vitest";`,
        `import { ${subject} } from "../src/${subject}.ts";`,
        ``,
        `it("${id}", () => {`,
        `  expect(${subject}(" 2026 ")).toStrictEqual("2026");`,
        `});`,
        ``,
      ].join("\n"),
      path: CheckSpec.guards.RedThenGreen(check)
        ? check.path
        : RepoPath.make(`test/${id}.test.ts`),
    }
  );
};

/** Where a canonical `main` stands now. */
const tipOf = (name: RepoName) =>
  Effect.gen(function* () {
    const refs = yield* (yield* RepoHost).refs(name).pipe(Effect.orDie);

    return LandedSha.make(
      Option.getOrThrow(Option.fromNullishOr(refs.get(mainRef)))
    );
  });

/** Where datekit's `main` stands now. */
const mainTip = tipOf(repo);

/** A commit's author, committer, parents and trailers. */
const commitOf = (sha: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const read = yield* host.readCommit(repo, sha).pipe(Effect.orDie);
    const { author, committer, message, parents } = Option.getOrThrow(read);

    return { author, committer, parents, trailers: parseTrailers(message) };
  });

const scheduled = ScheduledAlarm.use(({ at }) => at);

/** The project's rows as its store keeps them. */
const stored = ProjectStore.use((store) => store.load());

/** alice makes a project's first landing: `files`, pushed to its empty repo. */
const made = (api: ProjectApi, on: RepoName, files: Files = start) =>
  Effect.gen(function* () {
    yield* api.initProject(alice, {});

    const first = yield* Pusher.use((pusher) =>
      pusher.push(on, Option.none(), files, "Start")
    );

    yield* api.recordFirstPush(alice, first);

    return api;
  });

/** alice makes datekit and pushes its first commit. */
const begun = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  return yield* made(yield* projectService(project), repo);
});

/** The check of an ask with these files, scripted to fail twice on main as it now stands. */
const redOnMain = (
  files: Array.NonEmptyReadonlyArray<{
    readonly content: string;
    readonly path: RepoPath;
  }>,
  on: RepoName = repo
) =>
  Effect.gen(function* () {
    const composed = yield* composedAt(on, yield* tipOf(on), files);

    yield* CheckScript.use((checker) =>
      checker.script(composed, redThenGreen, ["failed", "failed"])
    );
  });

/** alice opens `id`, its check scripted red twice on main. */
const openRed = (api: ProjectApi, id: string, on: RepoName = repo) =>
  Effect.gen(function* () {
    const files = askFiles(id);

    yield* redOnMain(files, on);

    return yield* api.openAsk(alice, { ask: AskId.make(id), files });
  });

const lanes = [redThenGreen, LaneName.make("lint"), LaneName.make("types")];

/** `files` with `path` holding `content`, added or replaced. */
const changed = (files: Files, path: string, content: string): Files => [
  ...files.filter(([each]) => each !== path),
  [path, content],
];

/** The files main holds after `ids`' asks opened on it. */
const withAskFiles = (files: Files, ...ids: readonly string[]): Files => [
  ...files,
  ...ids.flatMap((id) =>
    askFiles(id).map(({ content, path }) => [path, content] as const)
  ),
];

/**
 * `who` claims `id` and answers it with `change` on main as it stands, every
 * lane scripted to pass on the merge: what reaches the answer's checks.
 */
const answered = (
  api: ProjectApi,
  input: {
    readonly change: readonly [path: string, content: string];
    readonly files: Files;
    readonly id: string;
    readonly on?: RepoName;
    readonly who: Person;
  }
) =>
  Effect.gen(function* () {
    const ask = AskId.make(input.id);
    const on = input.on ?? repo;
    const base = yield* tipOf(on);
    const { claim } = yield* api.claim(input.who, ask);

    const head = yield* Pusher.use((pusher) =>
      pusher.push(
        claim.fork,
        Option.some(base),
        changed(input.files, ...input.change)
      )
    );

    const merged = yield* mergedAt({
      base,
      fork: claim.fork,
      head,
      main: base,
      repo: on,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        lanes,
        (lane) => checker.script(merged, lane, ["passed"]),
        {
          discard: true,
        }
      )
    );

    const receipt = yield* api.submitAnswer(input.who, {
      ask,
      base,
      head,
      requestId: RequestId.make(`req-${input.id}`),
    });

    return { base, fork: claim.fork, head, receipt };
  });

const firstDecision = DecisionId.make("dec-000001");

/** carol proposes `trim-input` with its files; alice accepts it. */
const proposing = (api: ProjectApi) =>
  Effect.gen(function* () {
    const files = askFiles("trim-input");

    const proposed = yield* api.proposeAsk(carol, {
      files,
      territory: "packages/trim",
      want: askOf("trim-input").brief.want,
    });

    const onToday = yield* api.today(alice);
    const alarm = yield* scheduled;

    const second = yield* api.proposeAsk(carol, { want: "Trim tabs too" });

    const third = yield* api
      .proposeAsk(carol, { want: "Trim newlines too" })
      .pipe(Effect.flip);

    yield* redOnMain(files);

    const accepted = yield* api.decide(alice, {
      choice: "accept",
      decision: firstDecision,
    });

    const landed = yield* mainTip;

    return {
      accepted,
      again: yield* api
        .decide(alice, { choice: "decline", decision: firstDecision })
        .pipe(Effect.flip),
      alarm,
      bobDecides: yield* api
        .decide(bob, {
          choice: "accept",
          decision: DecisionId.make("dec-000002"),
        })
        .pipe(Effect.flip),
      commit: yield* commitOf(landed),
      listed: yield* api.listAsks(anyone),
      onToday,
      proposals: (yield* stored).proposals,
      proposed,
      second,
      third,
    };
  });

/** carol's proposal, left alone for its fourteen days. */
const expiring = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* api.proposeAsk(carol, { want: "Trim tabs too" });
    yield* advanceTo("2026-10-21T12:00:00Z");
    yield* api.onAlarm();

    const { decisions, proposals } = yield* stored;
    const events = yield* api.events(0, 100);

    return {
      decided: events.flatMap(({ event }) =>
        ProjectEvent.guards.Decided(event)
          ? [{ choice: event.choice, decision: event.decision }]
          : []
      ),
      decisions,
      proposals,
      today: yield* api.today(alice),
    };
  });

/**
 * carol proposes `trim-input`, and alice accepts it while the Checker cannot
 * run its check; then again, once it can.
 */
const acceptingBlocked = (api: ProjectApi) =>
  Effect.gen(function* () {
    const files = askFiles("trim-input");

    yield* api.proposeAsk(carol, {
      files,
      territory: "packages/trim",
      want: askOf("trim-input").brief.want,
    });

    const blocked = yield* api
      .decide(alice, { choice: "accept", decision: firstDecision })
      .pipe(Effect.result, Effect.map(Result.getFailure));

    const between = yield* stored;
    const { budget } = yield* api.today(alice);

    yield* redOnMain(files);

    const accepted = yield* api
      .decide(alice, { choice: "accept", decision: firstDecision })
      .pipe(
        Effect.result,
        Effect.map(Result.getSuccess),
        Effect.map(Option.map(({ decision }) => decision.decided?.choice))
      );

    return {
      accepted,
      blocked,
      budget,
      decided: between.decisions.map(({ decided }) => decided),
      listed: (yield* api.listAsks(anyone)).asks.map(({ ask }) => ask),
      proposals: between.proposals.map(({ state }) => state),
    };
  });

/** datekit, where alice decides the packages and frank the config folder only. */
const splitDeciders = {
  policy: {
    ...scenario.policy,
    deciders: [
      { handles: Array.make(alice.handle), paths: Glob.make("packages/**") },
      {
        handles: Array.make(frank.handle),
        paths: Glob.make(`${Brand.configDir}/**`),
      },
    ],
  },
};

/** carol proposes `trim-input` in the packages; who is asked to decide it. */
const askedToDecide = Effect.gen(function* () {
  const api = yield* begun;

  const { proposal } = yield* api.proposeAsk(carol, {
    files: askFiles("trim-input"),
    territory: "packages/trim",
    want: askOf("trim-input").brief.want,
  });

  return {
    alice: (yield* api.today(alice)).decisions.map(({ deciders, subject }) => ({
      deciders,
      subject,
    })),
    frank: (yield* api.today(frank)).decisions,
    proposal: proposal.id,
  };
});

describe("a proposal", () => {
  const world = worldOf(scenario, "memory");
  const proposal = ProposalId.make("prop-000001");
  const seen = Effect.flatMap(begun, proposing).pipe(Effect.provide(world));

  it.effect(
    "is a decision on Today for its deciders, with a default, expiring in fourteen days, and held to a cap",
    () =>
      Effect.map(seen, (run) => {
        expect(run.proposed.proposal).toStrictEqual({
          expiresAt: daysAfter(noon, 14),
          files: askFiles("trim-input").map(({ path }) => path),
          id: proposal,
          openedAt: noon,
          project,
          proposer: carol.handle,
          state: "open",
          territory: "packages/trim",
          want: askOf("trim-input").brief.want,
        });
        expect(
          run.onToday.decisions.map(
            ({ default: fallback, deciders, subject }) => ({
              deciders,
              fallback,
              subject,
            })
          )
        ).toStrictEqual([
          {
            deciders: [alice.handle],
            fallback: "decline",
            subject: DecisionSubject.cases.OpenProposal.make({ proposal }),
          },
        ]);
        expect(run.alarm).toStrictEqual(Option.some(daysAfter(noon, 14)));
        expect([run.second.proposal.state, run.third]).toStrictEqual([
          "open",
          new CapReached({ cap: 2 }),
        ]);
      })
  );

  it.effect(
    "accepted, opens its ask red first, asked by its proposer and decided by the decider",
    () =>
      Effect.map(seen, (run) => {
        expect(run.accepted.decision.decided).toStrictEqual({
          at: noon,
          by: alice.handle,
          choice: "accept",
        });
        expect({
          author: run.commit.author,
          committer: run.commit.committer,
          credits: run.commit.trailers.filter(({ key }) =>
            ["Asked-by", "Decided-by"].includes(key)
          ),
        }).toStrictEqual({
          author: authorLine(carol.handle),
          committer: committerLine,
          credits: [
            { key: "Asked-by", value: userOf("carol") },
            { key: "Decided-by", value: userOf("alice") },
          ],
        });
        expect(run.listed.asks.map(({ ask }) => ask)).toStrictEqual([
          AskId.make("trim-input"),
        ]);
        expect(run.proposals.map(({ id, state }) => [id, state])).toStrictEqual(
          [
            [proposal, "accepted"],
            [ProposalId.make("prop-000002"), "open"],
          ]
        );
      })
  );

  it.effect("decided once, is closed, and only its deciders decide it", () =>
    Effect.map(seen, (run) => {
      expect(run.again).toStrictEqual(
        new DecisionClosed({ decision: firstDecision })
      );
      expect(run.bobDecides).toStrictEqual(new NotDecider({}));
    })
  );

  it.effect(
    "accepted while its check cannot run, decides nothing and stays open, so it can be accepted again",
    () =>
      Effect.map(
        Effect.flatMap(begun, acceptingBlocked).pipe(Effect.provide(world)),
        (run) => {
          expect(run.blocked).toStrictEqual(
            Option.some(new VerifierBlocked({}))
          );
          expect([run.decided, run.proposals, run.budget]).toStrictEqual([
            [undefined],
            ["open"],
            { finishes: 0, total: 5, used: 0 },
          ]);
          expect([run.accepted, run.listed]).toStrictEqual([
            Option.some("accept"),
            [AskId.make("trim-input")],
          ]);
        }
      )
  );

  it.effect(
    "is put to the deciders of its territory, not to those of the config folder its ask file sits in",
    () =>
      Effect.map(
        askedToDecide.pipe(Effect.provide(worldOf(splitDeciders, "memory"))),
        (run) => {
          expect(run.alice).toStrictEqual([
            {
              deciders: [alice.handle],
              subject: DecisionSubject.cases.OpenProposal.make({
                proposal: run.proposal,
              }),
            },
          ]);
          expect(run.frank).toStrictEqual([]);
        }
      )
  );

  it.effect(
    "left alone for fourteen days expires, and its decision takes its default by the platform's hand",
    () =>
      Effect.map(
        Effect.flatMap(begun, expiring).pipe(Effect.provide(world)),
        (run) => {
          const expiredAt = daysAfter(noon, 14);

          expect(run.proposals.map(({ state }) => state)).toStrictEqual([
            "expired",
          ]);
          expect(run.decisions.map(({ decided }) => decided)).toStrictEqual([
            { at: expiredAt, by: platformHandle, choice: "decline" },
          ]);
          expect(run.decided).toStrictEqual([
            { choice: "decline", decision: firstDecision },
          ]);
          expect(run.today.decisions).toStrictEqual([]);
        }
      )
  );
});

/** bob's answer to the `polish` ask `format-date`, finished by alice. */
const finishing = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* openRed(api, "format-date");

    const answer = yield* answered(api, {
      change: [
        "packages/format/src/format.ts",
        "export const format = (d) => d.toISOString();\n",
      ],
      files: withAskFiles(start, "format-date"),
      id: "format-date",
      who: bob,
    });

    const waiting = (yield* api.status(bob)).answers.map(
      ({ outcome }) => outcome
    );

    const bobFinishes = yield* api
      .finish(bob, {
        ask: AskId.make("format-date"),
        base: answer.base,
        head: answer.head,
        requestId: RequestId.make("finish-bob-01"),
      })
      .pipe(Effect.flip);

    const finish = {
      ask: AskId.make("format-date"),
      base: answer.base,
      head: answer.head,
      requestId: RequestId.make("finish-alice-01"),
    };

    // Her sign-in cases her handle otherwise than the policy does.
    const receipt = yield* api.finish(aliceSignedIn, finish);
    const landed = yield* mainTip;

    return {
      again: yield* api.finish(aliceSignedIn, finish),
      answer,
      bobFinishes,
      budget: (yield* api.today(alice)).budget,
      commit: yield* commitOf(landed),
      landed,
      receipt,
      settled: (yield* api.status(bob)).answers.map(({ outcome }) => outcome),
      waiting,
    };
  });

/**
 * bob's answer to `format-date`, which alice finishes with a commit of her
 * own on top; first with one that touches its check, which she may not.
 */
const finishingOnTop = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* openRed(api, "format-date");

    const files = withAskFiles(start, "format-date");
    const formatPath = "packages/format/src/format.ts";
    const ask = AskId.make("format-date");

    const answer = yield* answered(api, {
      change: [formatPath, "export const format = (d) => d.toISOString();\n"],
      files,
      id: "format-date",
      who: bob,
    });

    const polishedFiles = changed(
      files,
      formatPath,
      "export const format = (d) => d.toISOString().slice(0, 10);\n"
    );

    const polished = yield* Pusher.use((pusher) =>
      pusher.push(answer.fork, Option.some(answer.head), polishedFiles)
    );

    const judging = yield* Pusher.use((pusher) =>
      pusher.push(
        answer.fork,
        Option.some(polished),
        changed(
          polishedFiles,
          askOf("format-date").file,
          'export default "easier";\n'
        )
      )
    );

    const touched = yield* api
      .finish(alice, {
        ask,
        base: answer.base,
        head: judging,
        requestId: RequestId.make("finish-alice-02"),
      })
      .pipe(Effect.flip);

    const merged = yield* mergedAt({
      base: answer.base,
      fork: answer.fork,
      head: polished,
      main: answer.base,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        lanes,
        (lane) => checker.script(merged, lane, ["passed"]),
        {
          discard: true,
        }
      )
    );

    const receipt = yield* api.finish(alice, {
      ask,
      base: answer.base,
      head: polished,
      requestId: RequestId.make("finish-alice-03"),
    });

    const landed = yield* mainTip;
    const host = yield* RepoHost;

    const format = yield* host
      .readFile(
        repo,
        Revision.Commit({ sha: landed }),
        RepoPath.make(formatPath)
      )
      .pipe(Effect.orDie);

    return {
      commit: yield* commitOf(landed),
      format: Option.map(format, (bytes) => new TextDecoder().decode(bytes)),
      polished,
      receipt,
      touched,
    };
  });

describe("a finish", () => {
  const seen = Effect.flatMap(begun, finishing).pipe(
    Effect.provide(worldOf(scenario, "memory"))
  );

  it.effect("is a decider's, on an answer that waits on one", () =>
    Effect.map(seen, (run) => {
      expect(run.waiting).toStrictEqual([
        Outcome.cases.AwaitingFinish.make({}),
      ]);
      expect(run.bobFinishes).toStrictEqual(new NotDecider({}));
      expect(run.receipt).toStrictEqual({
        ask: AskId.make("format-date"),
        base: run.answer.base,
        head: run.answer.head,
        outcome: Outcome.cases.Checking.make({ stage: "human" }),
        project,
        requestId: RequestId.make("finish-alice-01"),
      });
    })
  );

  it.effect(
    "with the decider's commits on top, checks them again from the merge and lands them, the answerer still its author",
    () =>
      Effect.map(
        Effect.flatMap(begun, finishingOnTop).pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (run) => {
          expect(run.touched).toStrictEqual(
            new TouchedJudge({ paths: [askOf("format-date").file] })
          );
          expect([run.receipt.head, run.receipt.outcome]).toStrictEqual([
            run.polished,
            Outcome.cases.Checking.make({ stage: "merge" }),
          ]);
          expect(run.format).toStrictEqual(
            Option.some(
              "export const format = (d) => d.toISOString().slice(0, 10);\n"
            )
          );
          expect({
            author: run.commit.author,
            credits: run.commit.trailers.filter(({ key }) =>
              ["Signed-off-by", "Finished-by"].includes(key)
            ),
          }).toStrictEqual({
            author: authorLine(bob.handle),
            credits: [
              { key: "Signed-off-by", value: userOf("bob") },
              { key: "Finished-by", value: userOf("alice") },
            ],
          });
        }
      )
  );

  it.effect(
    "lands the answer credited Finished-by, once however often it is sent, and counts in the decider's budget, however her sign-in cases her handle",
    () =>
      Effect.map(seen, (run) => {
        expect([run.settled, run.again.outcome]).toStrictEqual([
          [Outcome.cases.Landed.make({ sha: run.landed })],
          Outcome.cases.Landed.make({ sha: run.landed }),
        ]);
        expect({
          author: run.commit.author,
          credits: run.commit.trailers.filter(({ key }) =>
            ["Asked-by", "Signed-off-by", "Finished-by"].includes(key)
          ),
        }).toStrictEqual({
          author: authorLine(bob.handle),
          credits: [
            { key: "Asked-by", value: userOf("alice") },
            { key: "Signed-off-by", value: userOf("bob") },
            { key: "Finished-by", value: userOf("alice") },
          ],
        });
        expect(run.budget).toStrictEqual({ finishes: 1, total: 5, used: 0 });
      })
  );
});

/** alice makes her working fork, and lands a change of her own from it. */
const landingOwn = (api: ProjectApi) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const forked = yield* api.fork(alice);
    const again = yield* api.fork(alice);
    const daveForks = yield* api.fork(dave).pipe(Effect.flip);
    const base = yield* mainTip;
    const forkRefs = yield* host.refs(forked.fork).pipe(Effect.orDie);
    const forkMain = forkRefs.get(mainRef);

    const head = yield* Pusher.use((pusher) =>
      pusher.push(
        forked.fork,
        Option.some(base),
        changed(
          start,
          "packages/lexer/src/lex.ts",
          "export const lex = (s) => s.split(/ +/);\n"
        )
      )
    );

    const merged = yield* mergedAt({
      base,
      fork: forked.fork,
      head,
      main: base,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        [LaneName.make("lint"), LaneName.make("types")],
        (lane) => checker.script(merged, lane, ["passed"]),
        { discard: true }
      )
    );

    const request = {
      base,
      head,
      message: "Split words on runs of spaces\n\nTwo spaces are one gap.",
      requestId: RequestId.make("land-alice-01"),
    };

    const bobLands = yield* api.land(bob, request).pipe(Effect.flip);
    const receipt = yield* api.land(alice, request);
    const landed = yield* mainTip;

    const skipping = yield* Pusher.use((pusher) =>
      pusher.push(
        forked.fork,
        Option.some(head),
        changed(
          changed(
            start,
            "packages/lexer/src/lex.ts",
            "export const lex = (s) => s.split(/ +/);\n"
          ),
          "packages/lexer/test/lex.test.ts",
          'it.skip("lexes", () => {});\n'
        )
      )
    );

    const weakened = yield* api.land(alice, {
      base: head,
      head: skipping,
      message: "Skip the lexer's test",
      requestId: RequestId.make("land-alice-02"),
    });

    return {
      afterWeakened: yield* mainTip,
      again,
      base,
      bobLands,
      commit: yield* commitOf(landed),
      daveForks,
      forkMain,
      forked,
      jobs: yield* CheckScript.use(({ jobs }) => jobs),
      landed,
      merged,
      receipt,
      replay: yield* api.land(alice, request),
      view: (yield* api.landing(anyone, landed)).landing,
      weakened,
    };
  });

describe("a decider's own change", () => {
  const seen = Effect.flatMap(begun, landingOwn).pipe(
    Effect.provide(worldOf(scenario, "memory"))
  );

  it.effect(
    "comes from a working fork that is made once, for vouched people only",
    () =>
      Effect.map(seen, (run) => {
        const fork = RepoName.make(`${project}--me--alice`);

        expect(run.forked).toStrictEqual({
          fork,
          remote: `https://${Brand.domain}/${fork}.git`,
        });
        expect([run.again, run.forkMain]).toStrictEqual([run.forked, run.base]);
        expect(run.daveForks).toStrictEqual(new NotVouched({}));
      })
  );

  it.effect(
    "passes the same stages and checks, and lands once as a platform commit its decider authors",
    () =>
      Effect.map(seen, (run) => {
        expect(run.bobLands).toStrictEqual(new NotDecider({}));
        expect([run.receipt, run.replay]).toStrictEqual([
          {
            base: run.base,
            head: run.receipt.head,
            outcome: Outcome.cases.Landed.make({ sha: run.landed }),
            project,
            requestId: RequestId.make("land-alice-01"),
          },
          run.receipt,
        ]);
        expect({
          author: run.commit.author,
          committer: run.commit.committer,
          parents: run.commit.parents,
          signed: run.commit.trailers.filter(
            ({ key }) => key === "Signed-off-by"
          ),
        }).toStrictEqual({
          author: authorLine(alice.handle),
          committer: committerLine,
          parents: [run.base],
          signed: [{ key: "Signed-off-by", value: userOf("alice") }],
        });
        expect(run.view).toMatchObject({
          author: alice.handle,
          parent: run.base,
          requestId: RequestId.make("land-alice-01"),
          sha: run.landed,
        });
      })
  );

  it.effect(
    "checks its merged tree in the decider's working fork, where the Lander's merge leaves it",
    () =>
      Effect.map(seen, (run) => {
        expect(
          run.jobs
            .filter(({ at }) => shaOf(at) === shaOf(run.merged))
            .map((job) => job.repo)
        ).toStrictEqual([run.forked.fork]);
      })
  );

  it.effect(
    "is refused by stage 1 when it weakens a check, and main stays",
    () =>
      Effect.map(seen, (run) => {
        expect(run.afterWeakened).toBe(run.landed);
        expect(
          Outcome.guards.Refused(run.weakened.outcome)
            ? run.weakened.outcome.refusals.map(({ _tag }) => _tag)
            : []
        ).toStrictEqual(["Weakened"]);
      })
  );
});

/**
 * The world, with a rules evaluator that also reads the vouch file at the
 * commit it evaluates, as the real one does (204's `finishPolicy`): its
 * lines join the scenario's.
 */
const vouchingWorld = Layer.effect(
  RulesEvaluator,
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;

    return RulesEvaluator.of({
      ...evaluator,
      evaluate: (input) =>
        Effect.map(evaluator.evaluate(input), (policy) => ({
          ...policy,
          vouches: [
            ...policy.vouches,
            ...parseVouchFile(input.facts.vouchFile ?? "").vouches.map(
              ({ denounced, handle }) => ({ denounced, handle })
            ),
          ],
        })),
    });
  })
).pipe(Layer.provideMerge(worldOf(scenario, "memory")));

/** The vouch file on main. */
const vouchFileNow = Effect.gen(function* () {
  const host = yield* RepoHost;
  const at = yield* mainTip;

  const bytes = yield* host
    .readFile(
      repo,
      Revision.Commit({ sha: at }),
      RepoPath.make(`${Brand.configDir}/vouched.td`)
    )
    .pipe(Effect.orDie);

  return Option.map(bytes, (read) => new TextDecoder().decode(read));
});

/** alice vouches for dave, who could not claim before, and denounces erin. */
const vouching = (api: ProjectApi) =>
  Effect.gen(function* () {
    yield* openRed(api, "lex-tokens");
    yield* openRed(api, "parse-iso");

    const lexTokens = AskId.make("lex-tokens");
    const before = yield* api.claim(dave, lexTokens).pipe(Effect.flip);

    const bobVouches = yield* api
      .vouch(bob, { handle: Handle.make("dave"), verdict: "vouch" })
      .pipe(Effect.flip);

    const vouched = yield* api.vouch(alice, {
      handle: Handle.make("dave"),
      verdict: "vouch",
    });

    const fileAfterVouch = yield* vouchFileNow;
    const commit = yield* commitOf(vouched.landed);
    const claimed = yield* api.claim(dave, lexTokens);

    const again = yield* api.vouch(alice, {
      handle: Handle.make("dave"),
      verdict: "vouch",
    });

    const denounced = yield* api.vouch(alice, {
      handle: Handle.make("erin"),
      note: "pushed  a secret",
      verdict: "denounce",
    });

    return {
      again,
      before,
      bobVouches,
      claimed: claimed.claim.state,
      commit,
      denounced,
      erinClaims: yield* api
        .claim(erin, AskId.make("parse-iso"))
        .pipe(Effect.flip),
      fileAfterVouch,
      fileNow: yield* vouchFileNow,
      vouched,
    };
  });

describe("a vouch", () => {
  const seen = Effect.flatMap(begun, vouching).pipe(
    Effect.provide(vouchingWorld)
  );

  it.effect(
    "is a decider's platform landing of the vouch file, with the person added",
    () =>
      Effect.map(seen, (run) => {
        expect(run.bobVouches).toStrictEqual(new NotDecider({}));
        expect(run.fileAfterVouch).toStrictEqual(Option.some("dave\n"));
        expect({
          author: run.commit.author,
          committer: run.commit.committer,
          decided: run.commit.trailers.filter(
            ({ key }) => key === "Decided-by"
          ),
        }).toStrictEqual({
          author: authorLine(alice.handle),
          committer: committerLine,
          decided: [{ key: "Decided-by", value: userOf("alice") }],
        });
        expect(run.again).toStrictEqual(run.vouched);
      })
  );

  it.effect(
    "lets a person claim who could not before, and a denouncement bars one who could",
    () =>
      Effect.map(seen, (run) => {
        expect([run.before, run.claimed]).toStrictEqual([
          new NotVouched({}),
          "live",
        ]);
        expect(run.denounced.landed).not.toBe(run.vouched.landed);
        expect(run.fileNow).toStrictEqual(
          Option.some("dave\n-erin pushed a secret\n")
        );
        expect(run.erinClaims).toStrictEqual(new Denounced({}));
      })
  );
});

/** Six proposals an hour apart, from three people, and alice taking the first. */
const filling = (api: ProjectApi) =>
  Effect.gen(function* () {
    const proposers = [carol, eve, frank, carol, eve, frank];

    yield* Effect.forEach(
      proposers,
      (who, index) =>
        Effect.andThen(
          advanceTo(DateTime.formatIso(DateTime.add(noon, { hours: index }))),
          api.proposeAsk(who, { want: `Want number ${index + 1}` })
        ),
      { discard: true }
    );

    const full = yield* api.today(alice);

    yield* api.decide(alice, {
      choice: "decline",
      decision: firstDecision,
      note: "Not this one",
    });

    const flag = yield* api.flagAsk(carol, {
      ask: AskId.make("parse-iso"),
      reason: "Its check reads the wall clock",
    });

    return {
      afterOne: yield* api.today(alice),
      bobToday: yield* api.today(bob).pipe(Effect.flip),
      flag,
      flagUnknown: yield* api
        .flagAsk(eve, { ask: AskId.make("no-such-ask"), reason: "Gone" })
        .pipe(Effect.flip),
      full,
    };
  });

const idsOf = (decisions: readonly { readonly id: DecisionId }[]) =>
  decisions.map(({ id }) => id);

const decisionIds = (from: number, to: number) =>
  Array.range(from, to).map((n) =>
    DecisionId.make(`dec-${String(n).padStart(6, "0")}`)
  );

describe("Today", () => {
  it.effect(
    "shows a decider at most the budget's decisions, soonest to expire first, and counts the rest as overflow",
    () =>
      Effect.map(
        Effect.flatMap(begun, (api) =>
          Effect.andThen(openRed(api, "parse-iso"), filling(api))
        ).pipe(Effect.provide(worldOf(scenario, "memory"))),
        (seen) => {
          expect({
            budget: seen.full.budget,
            decider: seen.full.decider,
            decisions: idsOf(seen.full.decisions),
            overflow: seen.full.overflow,
          }).toStrictEqual({
            budget: { finishes: 0, total: 5, used: 0 },
            decider: alice.handle,
            decisions: decisionIds(1, 5),
            overflow: 1,
          });
          expect({
            budget: seen.afterOne.budget,
            decisions: idsOf(seen.afterOne.decisions),
            overflow: seen.afterOne.overflow,
          }).toStrictEqual({
            budget: { finishes: 0, total: 5, used: 1 },
            decisions: decisionIds(2, 5),
            overflow: 2,
          });
          expect(seen.bobToday).toStrictEqual(new NotDecider({}));
        }
      )
  );

  it.effect("holds a flag on an open ask as a proposal for its deciders", () =>
    Effect.map(
      Effect.flatMap(begun, (api) =>
        Effect.andThen(openRed(api, "parse-iso"), filling(api))
      ).pipe(Effect.provide(worldOf(scenario, "memory"))),
      (seen) => {
        expect(seen.flag.proposal).toMatchObject({
          files: [],
          flags: AskId.make("parse-iso"),
          proposer: carol.handle,
          state: "open",
          want: "Its check reads the wall clock",
        });
        expect(seen.flagUnknown).toStrictEqual(
          new UnknownAsk({ ask: AskId.make("no-such-ask") })
        );
      }
    )
  );
});

const burrow = ProjectName.make("burrow");

/** One landing's credit in the parser module. */
const row = (name: ProjectName, role: "Asked-by" | "Signed-off-by") => ({
  area: "parser",
  count: 1,
  project: name,
  role,
});

/** bob answers `parse-iso` in datekit, and carol in burrow, both made through `Projects`. */
const crediting = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");

  const projects = yield* Projects;

  const answerIn = (name: ProjectName, who: Person) =>
    Effect.gen(function* () {
      const on = RepoName.make(name);
      const api = yield* made(yield* projects.create(name), on);

      yield* openRed(api, "parse-iso", on);
      yield* answered(api, {
        change: [
          "packages/parser/src/parse.ts",
          "export const parse = (s) => ({ year: 2026 });\n",
        ],
        files: withAskFiles(start, "parse-iso"),
        id: "parse-iso",
        on,
        who,
      });

      return api;
    });

  const datekit = yield* answerIn(project, bob);

  yield* answerIn(burrow, carol);

  const among = [project, burrow];

  return {
    alice: yield* creditsFor(alice.handle, among),
    bob: yield* creditsFor(bob.handle, among),
    bobInDatekit: yield* datekit.credits(anyone, bob.handle),
    dave: yield* creditsFor(dave.handle, among),
  };
});

// Assisted-by never reaches a credit row (220's `creditsByArea` test, and
// `CreditSummary`'s role type); no answer here carries an agent trailer,
// since 214's answers carry none yet.
describe("credits", () => {
  it.effect("count a person's roles by project and area across projects", () =>
    Effect.map(
      crediting.pipe(
        Effect.provide(
          ProjectsMemory.pipe(Layer.provideMerge(worldOf(scenario, "memory")))
        )
      ),
      (seen) => {
        expect(seen.bob).toStrictEqual([row(project, "Signed-off-by")]);
        expect(seen.bobInDatekit).toStrictEqual({ credits: seen.bob });
        expect(seen.alice).toStrictEqual([
          row(burrow, "Asked-by"),
          row(project, "Asked-by"),
        ]);
        expect(seen.dave).toStrictEqual([]);
      }
    )
  );
});

/** A commit pushed straight onto canonical main, past the platform. */
const strayOnto = (first: CommitSha) =>
  Pusher.use((pusher) =>
    pusher.push(
      repo,
      Option.some(first),
      changed(
        start,
        "packages/trim/src/trim.ts",
        "export const trim = (s) => s.trimEnd();\n"
      ),
      "Stray"
    )
  );

/** canonical main's move as OnPush reports it to the project: from nobody the platform knows. */
const reported = (
  api: ProjectApi,
  eventId: string,
  move: { readonly after: CommitSha; readonly before?: CommitSha }
) =>
  api.recordPush({
    after: move.after,
    before: Option.fromUndefinedOr(move.before),
    eventId,
    pusher: anyone,
    ref: "refs/heads/main",
    repo,
  });

/**
 * Canonical main's moves as OnPush reports them: the initializer's first
 * push, an ask's landing, then a push the platform did not make, twice
 * under one event id.
 */
const strayReported = Effect.gen(function* () {
  const api = yield* begun;
  const first = yield* mainTip;

  yield* reported(api, "evt-first", { after: first });

  const { landed } = yield* openRed(api, "parse-iso");

  yield* reported(api, "evt-landed", { after: landed, before: first });

  const stray = yield* strayOnto(landed);

  yield* reported(api, "evt-stray", { after: stray, before: landed });
  yield* reported(api, "evt-stray", { after: stray, before: landed });

  return {
    decisions: (yield* api.today(alice)).decisions.map(
      ({ deciders, default: byDefault, expiresAt, subject }) => ({
        byDefault,
        deciders,
        expiresAt,
        subject,
      })
    ),
    first,
    firstLanding: Exit.map(
      yield* Effect.exit(api.landing(alice, first)),
      ({ landing }) => ({ ask: landing.ask, author: landing.author })
    ),
    landed,
    stray,
  };
});

/**
 * A push to canonical main the platform did not make, reported by OnPush
 * (313), which opens the decision, then decided by alice.
 */
const strayDecided = (choice: "accept" | "decline") =>
  Effect.gen(function* () {
    const api = yield* begun;
    const host = yield* RepoHost;
    const first = yield* mainTip;
    const stray = yield* strayOnto(first);

    yield* reported(api, "evt-stray", { after: stray, before: first });

    const decided = yield* api.decide(alice, {
      choice,
      decision: firstDecision,
    });

    const tip = yield* mainTip;

    const treeOf = (sha: CommitSha) =>
      Effect.map(host.readCommit(repo, sha).pipe(Effect.orDie), (read) =>
        Option.map(read, ({ tree }) => tree)
      );

    return {
      commit: yield* commitOf(tip),
      decided: decided.decision.decided?.choice,
      first,
      firstTree: yield* treeOf(first),
      landed: Option.flatMap((yield* stored).project, ({ landed }) =>
        Option.fromUndefinedOr(landed)
      ),
      stray,
      tip,
      tipTree: yield* treeOf(tip),
    };
  });

/** canonical main deleted past the platform, as OnPush reports it, then decided by alice. */
const deletedDecided = (choice: "accept" | "decline") =>
  Effect.gen(function* () {
    const api = yield* begun;
    const first = yield* mainTip;

    yield* reported(api, "evt-deleted", {
      after: CommitSha.make("0".repeat(40)),
      before: first,
    });

    const decided = yield* api.decide(alice, {
      choice,
      decision: firstDecision,
    });

    return {
      decided: decided.decision.decided?.choice,
      first,
      landed: Option.flatMap((yield* stored).project, ({ landed }) =>
        Option.fromUndefinedOr(landed)
      ),
      tip: yield* mainTip,
    };
  });

describe("a stray push", () => {
  it.effect.each(["accept", "decline"] as const)(
    "that deleted main is put to the deciders, and decided %s moves neither main nor the landed SHA",
    (choice) =>
      Effect.map(
        deletedDecided(choice).pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (seen) => {
          expect([seen.decided, seen.tip, seen.landed]).toStrictEqual([
            choice === "accept" ? "adopt" : "revert",
            seen.first,
            Option.some(seen.first),
          ]);
        }
      )
  );

  it.effect(
    "reported by OnPush opens one StrayPush decision, default revert, however often the event comes; main moved by the platform opens none",
    () =>
      Effect.map(
        strayReported.pipe(Effect.provide(worldOf(scenario, "memory"))),
        (seen) => {
          expect(seen.decisions).toStrictEqual([
            {
              byDefault: "revert",
              deciders: [alice.handle],
              expiresAt: daysAfter(noon, 14),
              subject: DecisionSubject.cases.StrayPush.make({
                after: seen.stray,
                before: seen.landed,
                ref: RefNameText.make("refs/heads/main"),
              }),
            },
          ]);
          expect(seen.firstLanding).toStrictEqual(
            Exit.succeed({ ask: undefined, author: alice.handle })
          );
        }
      )
  );

  it.effect(
    "decided revert lands a commit on top of it with the tree it replaced, and a Reverts trailer",
    () =>
      Effect.map(
        strayDecided("decline").pipe(
          Effect.provide(worldOf(scenario, "memory"))
        ),
        (seen) => {
          expect(seen.decided).toBe("revert");
          expect(seen.landed).toStrictEqual(Option.some(seen.tip));
          expect(seen.tipTree).toStrictEqual(seen.firstTree);
          expect({
            author: seen.commit.author,
            committer: seen.commit.committer,
            parents: seen.commit.parents,
            trailers: seen.commit.trailers.filter(({ key }) =>
              ["Decided-by", "Reverts"].includes(key)
            ),
          }).toStrictEqual({
            author: authorLine(alice.handle),
            committer: committerLine,
            parents: [seen.stray],
            trailers: [
              { key: "Decided-by", value: userOf("alice") },
              { key: "Reverts", value: seen.stray },
            ],
          });
        }
      )
  );

  it.effect("decided adopt becomes the landed SHA, and main stays", () =>
    Effect.map(
      strayDecided("accept").pipe(Effect.provide(worldOf(scenario, "memory"))),
      (seen) => {
        expect(seen.decided).toBe("adopt");
        expect([seen.tip, seen.landed]).toStrictEqual([
          seen.stray,
          Option.some(seen.stray),
        ]);
      }
    )
  );
});
