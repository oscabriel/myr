/**
 * The dev world's seed: both fictional projects (`examples.ts`) brought to
 * a state where every page has something to show, by the project service's
 * own methods, in the order people would act. The seed plays the people and
 * the platform's other parts: the initializer's first push and the gateway
 * that reports it, a decider opening asks, a contributor claiming one,
 * pushing an answer to the claim's fork through a harness and offering it
 * as custody does (it lands, through the answer's run, in the same call,
 * with the harness disclosed as `Assisted-by:`), people proposing
 * and flagging, the decider declining two, and someone pushing straight to
 * `main`, reported as the push event would be.
 *
 * Each step happens at its own whole minute of the world's calendar
 * (`devMinute`), so every time the world holds comes from one start and
 * two seeds on the same start give the same world. The world then serves
 * from the last step's minute, `seedEnd`.
 *
 * What the service can't be brought to through its methods is left out:
 * a `Finish` decision (nothing opens one yet) and an
 * answer refused `OutOfScope` (a refused answer is never recorded).
 */
import { RefName, RefOutcome, RepoHost } from "@repo/artifacts/repo-host";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import type { HarnessAudit } from "@repo/protocol/audit";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { AskId, Handle, keyOf, RepoName, RequestId } from "@repo/protocol/ids";
import type { CommitSha, ProjectName, ProposalId } from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { Array, DateTime, Effect, Option } from "effect";

import { DevClock, devMinute } from "./clock.ts";
import {
  burrow,
  burrowPeople,
  datekit,
  datekitPeople,
  operator,
} from "./examples.ts";
import type { Opening } from "./examples.ts";
import { filesAt, overlay, personIdentity, scratch, textOf } from "./git.ts";
import type { Files } from "./git.ts";

const mainRef = RefName.make("refs/heads/main");

/** People who propose and flag in datekit; nobody vouched for them. */
export const visitors = {
  flagger: Handle.make("sefa"),
  proposer: Handle.make("tove"),
  regular: Handle.make("wren"),
} as const;

/** Everyone in the seed: the people a dev token may sign in as. */
export const devPeople: readonly Handle[] = [
  operator,
  datekitPeople.decider,
  datekitPeople.zones,
  datekitPeople.contributor,
  visitors.proposer,
  visitors.flagger,
  visitors.regular,
  burrowPeople.decider,
  burrowPeople.second,
];

const as = (handle: Handle) => Person.make({ handle });

/**
 * The harness bram answers through, as the CLI's credential helper names it
 * to the gateway and custody reports it: audit metadata, never a credit.
 */
const bramsHarness = {
  harness: "claude-code",
  model: "haiku",
} as const satisfies HarnessAudit;

/** A commit of `files` on `parent` (or a first commit), by `author`, at the world's time. */
const commitOf = (input: {
  readonly author: Handle;
  readonly files: Files;
  readonly message: string;
  readonly parent: Option.Option<CommitSha>;
}) =>
  Effect.gen(function* () {
    const into = yield* scratch;
    const who = personIdentity(input.author);

    const commit = yield* into.commit({
      at: yield* DateTime.now,
      author: who,
      committer: who,
      message: input.message,
      parents: Option.toArray(input.parent),
      tree: yield* into.tree(input.files),
    });

    return { commit, source: into.source };
  });

/** A commit pushed to `repo`'s main with a compare-and-swap from `parent`. */
const pushed = (repo: RepoName, input: Parameters<typeof commitOf>[0]) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const { commit, source } = yield* commitOf(input);

    const outcomes = yield* host.push(repo, source, [
      { from: input.parent, ref: mainRef, to: commit },
    ]);

    if (!outcomes.every(RefOutcome.$is("Updated"))) {
      return yield* Effect.die(`${repo}'s main moved under the seed`);
    }

    return commit;
  });

/** The files of `repo` at `commit`, which the seed itself pushed. */
const filesOf = (repo: RepoName, commit: CommitSha) =>
  Effect.flatMap(filesAt(repo, commit), Effect.fromOption);

/** Moves the world's clock to the calendar's minute `minute`. */
const at = (minute: number) =>
  Effect.flatMap(Effect.service(DevClock), (clock) =>
    clock.set(devMinute(minute))
  );

/**
 * A project made and adopted at the calendar's instant `when`: its
 * initializer creates it, pushes its first commit a minute later, and the
 * gateway reports the push.
 */
export const startedAt = (
  project: ProjectName,
  initializer: Handle,
  files: Files,
  when: DateTime.Utc
) =>
  Effect.gen(function* () {
    const projects = yield* Projects;
    const clock = yield* DevClock;

    yield* clock.set(when);

    const api = yield* projects.create(project);

    yield* api.initProject(as(initializer), {});
    yield* clock.set(DateTime.add(when, { minutes: 1 }));

    const first = yield* pushed(RepoName.make(keyOf(project)), {
      author: initializer,
      files,
      message: "First commit",
      parent: Option.none(),
    });

    const { landed } = yield* api.recordFirstPush(as(initializer), first);

    return { api, landed };
  });

/** A project made and adopted at the calendar's minute `minute`. */
const started = (
  project: ProjectName,
  initializer: Handle,
  files: Files,
  minute: number
) =>
  Effect.map(
    startedAt(project, initializer, files, devMinute(minute)),
    ({ api }) => api
  );

/** Each ask opened by `decider` from its files, a minute apart from `minute`. */
export const opened = (
  api: ProjectApi,
  decider: Handle,
  asks: readonly (readonly [AskId, Opening])[],
  minute: number
) =>
  Effect.forEach(
    asks,
    ([ask, files], index) =>
      Effect.andThen(
        at(minute + index),
        api.openAsk(as(decider), { ask, files })
      ),
    { discard: true }
  );

/**
 * An answer to `ask` from `answerer`, who holds its claim: a commit of
 * `files` on the claim's base, pushed to the claim's fork through `audit`'s
 * harness, reported as the gateway's custody reports it, then offered as
 * the answer.
 */
const answered = (
  api: ProjectApi,
  answerer: Handle,
  input: {
    readonly ask: AskId;
    readonly audit: HarnessAudit;
    readonly files: Files;
    readonly message: string;
  }
) =>
  Effect.gen(function* () {
    const { claims } = yield* api.status(as(answerer));

    const claim = yield* Effect.fromOption(
      Array.findFirst(claims, ({ ask }) => ask === input.ask)
    );

    const base = yield* filesOf(claim.fork, claim.base);

    const head = yield* pushed(claim.fork, {
      author: answerer,
      files: overlay(textOf(base), input.files),
      message: input.message,
      parent: Option.some(claim.base),
    });

    const refusals = yield* api.recordPush({
      after: head,
      audit: input.audit,
      before: Option.some(claim.base),
      eventId: `${claim.fork}@${head}`,
      pusher: as(answerer),
      ref: mainRef,
      repo: claim.fork,
    });

    if (Array.isReadonlyArrayNonEmpty(refusals)) {
      return yield* Effect.die(refusals);
    }

    return yield* api.submitAnswer(as(answerer), {
      ask: input.ask,
      base: claim.base,
      head,
      requestId: RequestId.make(`push-${head}-${answerer}`),
    });
  });

/** The decision that puts proposal `proposal` to `decider`. */
const decisionOn = (api: ProjectApi, decider: Handle, proposal: ProposalId) =>
  Effect.flatMap(api.today(as(decider)), ({ decisions }) =>
    Effect.fromOption(
      Array.findFirst(
        decisions,
        ({ subject }: Decision) =>
          DecisionSubject.guards.OpenProposal(subject) &&
          subject.proposal === proposal
      )
    )
  );

/** Proposals from a regular that datekit's decider declines, each on its own minute. */
const DECLINED = [
  "parseISO accepts two-digit years.",
  "datekit wraps the Temporal API.",
];

/** datekit: four asks opened, one answered and landed, one claimed, decisions waiting. */
const seedDatekit = Effect.gen(function* () {
  const { contributor, decider } = datekitPeople;
  const api = yield* started(datekit.project, operator, datekit.files, 0);

  yield* opened(api, decider, datekit.asks, 2);

  yield* at(6);
  yield* api.claim(as(contributor), datekit.answer.ask);

  yield* at(7);
  yield* answered(api, contributor, {
    ...datekit.answer,
    audit: bramsHarness,
  });

  yield* at(8);
  yield* api.claim(as(contributor), AskId.make("parse-iso-week"));

  yield* at(9);
  yield* api.proposeAsk(as(visitors.proposer), {
    want: 'format(date, "Qo") prints the quarter as an ordinal.',
  });

  yield* at(10);
  yield* api.flagAsk(as(visitors.flagger), {
    ask: AskId.make("add-months-clamp"),
    reason: "Its check pins a common year only; leap years need a case too.",
  });

  yield* Effect.forEach(
    DECLINED,
    (want, index) =>
      Effect.gen(function* () {
        yield* at(11 + index * 2);

        const { proposal } = yield* api.proposeAsk(as(visitors.regular), {
          want,
        });

        yield* at(12 + index * 2);

        const decision = yield* decisionOn(api, decider, proposal.id);

        yield* api.decide(as(decider), {
          choice: "decline",
          decision: decision.id,
          note: "Out of scope for a small library.",
        });
      }),
    { discard: true }
  );

  return api;
});

/** burrow: the migrate ask opened as its family, six children and a delete child waiting on them. */
const seedBurrow = Effect.flatMap(
  started(burrow.project, operator, burrow.files, 15),
  (api) => opened(api, burrowPeople.decider, burrow.asks, 17)
);

/** The seed's last minute: the stray push. */
const STRAY_MINUTE = 21;

/** The calendar's instant the seed leaves the world's clock at. */
export const seedEnd = devMinute(STRAY_MINUTE);

/**
 * Someone with access to datekit's storage pushes to `main` past the
 * platform, and the push event reports it: a `StrayPush` decision whose
 * default is to revert.
 */
const strayPush = (api: ProjectApi) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const repo = RepoName.make(keyOf(datekit.project));

    yield* at(STRAY_MINUTE);

    const tip = yield* Effect.fromOption(
      Option.fromNullishOr((yield* host.refs(repo)).get(mainRef))
    );

    const after = yield* pushed(repo, {
      author: datekitPeople.zones,
      files: overlay(textOf(yield* filesOf(repo, tip)), datekit.stray.files),
      message: datekit.stray.message,
      parent: Option.some(tip),
    });

    yield* api.recordPush({
      after,
      before: Option.some(tip),
      eventId: `${repo}@${after}`,
      pusher: Anonymous.make({}),
      ref: mainRef,
      repo,
    });
  });

/**
 * Both projects, seeded; the world's clock left at the last step. Any
 * refusal on the way is a defect of the seed's, never a state to serve.
 */
export const seedDev: Effect.Effect<
  void,
  never,
  Projects | RepoHost | DevClock
> = Effect.gen(function* () {
  const datekitApi = yield* seedDatekit;

  yield* seedBurrow;
  yield* strayPush(datekitApi);
}).pipe(Effect.orDie);
