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

export const visitors = {
  flagger: Handle.make("sefa"),
  proposer: Handle.make("tove"),
  regular: Handle.make("wren"),
} as const;

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

const bramsHarness = {
  harness: "claude-code",
  model: "haiku",
} as const satisfies HarnessAudit;

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

const filesOf = (repo: RepoName, commit: CommitSha) =>
  Effect.flatMap(filesAt(repo, commit), Effect.fromOption);

const at = (minute: number) =>
  Effect.flatMap(Effect.service(DevClock), (clock) =>
    clock.set(devMinute(minute))
  );

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

const DECLINED = [
  "parseISO accepts two-digit years.",
  "datekit wraps the Temporal API.",
];

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

  // Two discussions: one open, one a maintainer turned into a proposal.
  yield* at(14);

  const talked = yield* api.postDiscussion(as(visitors.regular), {
    body: "Weeks start on Monday in ISO 8601, but on Sunday in the US; which does parseISO assume?",
    title: "Which day starts a week?",
  });

  yield* api.postDiscussion(as(decider), {
    body: "ISO, always: a locale never changes what a date string means.",
    discussion: talked.discussion.id,
  });

  yield* at(15);

  const asked = yield* api.postDiscussion(as(visitors.proposer), {
    body: "Could parseISO take week dates like 2026-W41-3 too?",
    title: "ISO week dates",
  });

  yield* at(16);
  yield* api.proposeAsk(as(decider), {
    discussion: asked.discussion.id,
    want: "parseISO reads an ISO week date to the day it names.",
  });

  yield* Effect.forEach(
    DECLINED,
    (want, index) =>
      Effect.gen(function* () {
        yield* at(17 + index * 2);

        const { proposal } = yield* api.proposeAsk(as(visitors.regular), {
          want,
        });

        yield* at(18 + index * 2);

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

const seedBurrow = Effect.flatMap(
  started(burrow.project, operator, burrow.files, 21),
  (api) => opened(api, burrowPeople.decider, burrow.asks, 23)
);

const STRAY_MINUTE = 27;

export const seedEnd = devMinute(STRAY_MINUTE);

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

export const seedDev: Effect.Effect<
  void,
  never,
  Projects | RepoHost | DevClock
> = Effect.gen(function* () {
  const datekitApi = yield* seedDatekit;

  yield* seedBurrow;
  yield* strayPush(datekitApi);
}).pipe(Effect.orDie);
