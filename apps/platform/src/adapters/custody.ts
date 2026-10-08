/**
 * The `Custody` port (`@repo/git/custody`) for one push, by who pushes and
 * which repo the name says it is (ADR 0004).
 *
 * `admit` is stage 0, before anything reaches the upstream: what the pusher
 * may move, from the project's own record through `ProjectApi`. A canonical
 * repo takes no push (`DirectPush`) but its initializer's first
 * (`firstPusher`); a claim's fork takes its claimant's pushes while the claim
 * is live, and a decider's commits on top when they finish its answer; a
 * working fork takes its owner's. `ProjectApi` has no read of the push facts the gate's parse
 * stage takes (the policy, the ask, the claim), so `admit` asks the
 * claimant's own `status` and leaves the full parse to `review`, where
 * `recordPush` runs it.
 *
 * `custodyFor` reads what `admit` needs before the gateway starts, and
 * `admit` answers at once. The gateway makes the push's upstream body as
 * soon as it has read the command list, before it asks `admit`, and that
 * body locks the request's the moment the fiber yields: an `admit` that
 * waits on anything and then refuses finds the body locked, and the push
 * fails with a 500 (better: `@repo/git/gateway` reads that body only once
 * the push is admitted).
 *
 * `review` runs after the upstream took the push. A first push becomes the
 * project's landed SHA. A claimant's push to their fork is reported to the
 * project (`recordPush`: liveness, then stages 0–1, every stage-1 refusal at
 * once); a clean one is offered as the answer (`submitAnswer`, the same path
 * as `<cli> submit`) and the pusher reads that it is being checked. The
 * gate's later stages never run inside the push.
 *
 * A harness that pushes names itself in the basic-auth username its
 * credential helper gives (`audit;harness=pi&model=…`, `@repo/protocol/audit`).
 * Custody logs it with the push and reports it with a claimant's push, so
 * the answer's landing discloses it as `Assisted-by:`. It is
 * audit metadata only: who pushes is the token's person, and the username is
 * never identity, credit or a score.
 */
import type { RepoName } from "@repo/artifacts/repo-host";
import { Custody } from "@repo/git/custody";
import type { Command } from "@repo/git/custody";
import type { ProjectApi } from "@repo/project/project";
import { Projects } from "@repo/project/projects";
import type { HarnessAudit } from "@repo/protocol/audit";
import { RequestId, sameHandle } from "@repo/protocol/ids";
import type { AskId, CommitSha, Handle, ProjectName } from "@repo/protocol/ids";
import { Principal } from "@repo/protocol/principal";
import type { Person } from "@repo/protocol/principal";
import { ClaimLapsed, DirectPush, NotClaimed } from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { receiptLine } from "@repo/protocol/render";
import { Array, Effect, Option, Result } from "effect";

import type { LayerTarget } from "../layer-gate.ts";
import { RepoKind } from "../repo-names.ts";

/** The branch every repo the platform makes keeps its work on. */
const mainRef = "refs/heads/main";

/** Says a line to the pusher, as a `remote:` line of git's output. */
export type Notice = (line: string) => Effect.Effect<void>;

/**
 * The request a push to a claim's fork answers with: it names the head and
 * the pusher, so two people pushing one commit make two requests. A request
 * id holds 64 characters, so the head comes first and is never cut: a long
 * handle is, and each new head is still a new request.
 */
export const pushRequestId = (pusher: Handle, head: CommitSha) =>
  RequestId.make(`push-${head}-${pusher.toLowerCase()}`.slice(0, 64));

/** The push event a push reports: one per (repo, head), so a replay is acted on once. */
const pushEventId = (repo: RepoName, head: CommitSha) => `push-${repo}-${head}`;

/** Every ref in the push turned away: main moves only by a landing. */
const directPushes = (commands: readonly Command[]) =>
  commands.map(({ ref }) => new DirectPush({ ref }));

/** Where a push moves `main`, if it moves it to a commit; a deletion moves it nowhere. */
const mainTip = (commands: readonly Command[]) =>
  Option.flatMap(
    Array.findFirst(commands, ({ ref }) => ref === mainRef),
    (command) =>
      Option.map(command.to, (head) => ({ from: command.from, head }))
  );

/** Runs `judge` against the project; a project never made refuses the push. */
const against = (
  projects: Projects["Service"],
  project: ProjectName,
  judge: (api: ProjectApi) => Effect.Effect<readonly Refusal[]>
): Effect.Effect<readonly Refusal[]> =>
  projects.get(project).pipe(
    Effect.flatMap(judge),
    Effect.catchTag("UnknownProject", (refused) => Effect.succeed([refused]))
  );

/** Custody whose `admit` decides at once, from what was read before the push. */
const custodyOf = (
  admit: (commands: readonly Command[]) => readonly Refusal[],
  review: Custody["Service"]["review"]
) =>
  Custody.of({
    admit: (_repo, commands) => Effect.succeed(admit(commands)),
    review,
  });

/**
 * A project's canonical repo: only its initializer's first push reaches it,
 * as the project says (`firstPusher`). A project never made has no first
 * pusher, so every push there is a direct push: custody fails closed.
 */
const canonical = (
  projects: Projects["Service"],
  project: ProjectName,
  pusher: Person
) =>
  Effect.gen(function* () {
    const first = yield* projects.get(project).pipe(
      Effect.flatMap((api) => api.firstPusher()),
      Effect.catchTag("UnknownProject", () => Effect.succeedNone)
    );

    const isFirst = Option.exists(first, (initializer) =>
      sameHandle(initializer, pusher.handle)
    );

    return custodyOf(
      (commands) =>
        commands.flatMap(({ ref, to }) =>
          isFirst && ref === mainRef && Option.isSome(to)
            ? []
            : [new DirectPush({ ref })]
        ),
      // Only a first push was admitted: it becomes the landed SHA, once.
      (_repo, commands) =>
        Option.match(mainTip(commands), {
          onNone: () => Effect.succeed(directPushes(commands)),
          onSome: ({ head }) =>
            against(projects, project, (api) =>
              api.recordFirstPush(pusher, head).pipe(
                Effect.as([]),
                Effect.catchTag("DirectPush", (refused) =>
                  Effect.succeed([refused])
                )
              )
            ),
        })
    );
  });

/** The claim `person` has on `ask`, as their own `status` shows it. */
const claimOn = (api: ProjectApi, person: Person, ask: AskId) =>
  Effect.map(api.status(person), ({ claims }) =>
    Array.findFirst(claims, (claim) => claim.ask === ask)
  );

/**
 * Whether the claimant may push to their claim's fork: a live or warned
 * claim lets them; a lapsed one is `ClaimLapsed`; none, or one released or
 * answered, is `NotClaimed`.
 */
const holds = (api: ProjectApi, person: Person, ask: AskId) =>
  Effect.map(claimOn(api, person, ask), (claim) =>
    Option.match(claim, {
      onNone: () => [NotClaimed.of(ask)],
      onSome: ({ state }) => {
        if (state === "live" || state === "warned") {
          return [];
        }

        return state === "lapsed"
          ? [ClaimLapsed.of(ask)]
          : [NotClaimed.of(ask)];
      },
    })
  );

/**
 * The claimant's push, which the fork already took: reported to the
 * project with the harness it came through, then, if stages 0–1 have
 * nothing to say, offered as the answer.
 */
const offer = (input: {
  readonly api: ProjectApi;
  readonly ask: AskId;
  readonly audit: Option.Option<HarnessAudit>;
  readonly from: Option.Option<CommitSha>;
  readonly head: CommitSha;
  readonly notice: Notice;
  readonly person: Person;
  readonly repo: RepoName;
}) =>
  Effect.gen(function* () {
    const { api, ask, head, person, repo } = input;

    const refusals = yield* api.recordPush({
      after: head,
      before: input.from,
      eventId: pushEventId(repo, head),
      pusher: person,
      ref: mainRef,
      repo,
      ...Option.match(input.audit, {
        onNone: () => ({}),
        onSome: (audit) => ({ audit }),
      }),
    });

    if (Array.isReadonlyArrayNonEmpty(refusals)) {
      return refusals;
    }

    const claim = yield* claimOn(api, person, ask);

    if (Option.isNone(claim)) {
      return [NotClaimed.of(ask)];
    }

    const submitted = yield* Effect.result(
      api.submitAnswer(person, {
        ask,
        base: claim.value.base,
        head,
        requestId: pushRequestId(person.handle, head),
      })
    );

    if (Result.isFailure(submitted)) {
      return [submitted.failure];
    }

    return yield* Result.match(receiptLine(submitted.success), {
      onFailure: Effect.succeed,
      onSuccess: (line) => Effect.as(input.notice(line), []),
    });
  });

/** A claim's fork: its claimant while the claim is live, or a decider finishing its answer. */
const claimFork = (
  projects: Projects["Service"],
  fork: Extract<RepoKind, { readonly _tag: "ClaimFork" }>,
  pusher: Person,
  notice: Notice,
  audit: Option.Option<HarnessAudit>
) =>
  Effect.gen(function* () {
    const isClaimant = sameHandle(pusher.handle, fork.handle);

    // A decider finishes an answer by pushing onto its fork.
    const refused = yield* against(projects, fork.project, (api) =>
      isClaimant
        ? holds(api, pusher, fork.ask)
        : Effect.map(Effect.isSuccess(api.today(pusher)), (decides) =>
            decides ? [] : [NotClaimed.of(fork.ask)]
          )
    );

    return custodyOf(
      () => refused,
      // A decider's commits are judged by `<cli> finish`, not by the push.
      (repo, commands) =>
        Option.match(
          Option.filter(mainTip(commands), () => isClaimant),
          {
            onNone: () => Effect.succeed([]),
            onSome: ({ from, head }) =>
              against(projects, fork.project, (api) =>
                offer({
                  api,
                  ask: fork.ask,
                  audit,
                  from,
                  head,
                  notice,
                  person: pusher,
                  repo,
                })
              ),
          }
        )
    );
  });

/** What a push's log lines and span carry: who pushes, to which kind of repo, through which harness. */
type PushAnnotations = HarnessAudit & {
  readonly pusher: string;
  readonly target: RepoKind["_tag"];
};

const annotationsOf = (
  pusher: Person,
  kind: RepoKind,
  audit: Option.Option<HarnessAudit>
): PushAnnotations => ({
  ...Option.getOrElse(audit, (): HarnessAudit => ({})),
  pusher: pusher.handle,
  target: kind._tag,
});

/**
 * `custody` with every log line it writes annotated, and its review in a
 * span with the same attributes. `admit` stays synchronous: the gateway's
 * body locks the moment the fiber yields.
 */
const annotated = (custody: Custody["Service"], annotations: PushAnnotations) =>
  Custody.of({
    admit: (repo, commands) =>
      custody.admit(repo, commands).pipe(Effect.annotateLogs(annotations)),
    review: (repo, commands) =>
      custody
        .review(repo, commands)
        .pipe(
          Effect.annotateLogs(annotations),
          Effect.withSpan("custody.review", { attributes: annotations })
        ),
  });

/** Custody that takes every push as it comes: a person's own working fork. */
const takeAll = custodyOf(
  () => [],
  () => Effect.succeed([])
);

/** Custody that takes no push at all: every ref is a direct push. */
export const refuseAll = custodyOf(directPushes, (_repo, commands) =>
  Effect.succeed(directPushes(commands))
);

/**
 * Custody of one push by `pusher` to the repo `kind` names. `notice` says a
 * line to the pusher once the push went through: what became of the answer
 * it offered. `audit` is the harness the push came through (`auditOf` in
 * `credential.ts`), if its username named one: logged with the push and
 * reported with a claimant's, never who pushes. Only a signed-in person
 * pushes anywhere.
 */
export const custodyFor = (
  pusher: Principal,
  kind: RepoKind,
  notice: Notice = () => Effect.void,
  audit: Option.Option<HarnessAudit> = Option.none()
): Effect.Effect<Custody["Service"], never, Projects> =>
  Effect.gen(function* () {
    if (!Principal.guards.Person(pusher)) {
      return refuseAll;
    }

    const projects = yield* Projects;
    const annotations = annotationsOf(pusher, kind, audit);

    yield* Effect.logInfo("a push reached custody").pipe(
      Effect.annotateLogs(annotations)
    );

    const custody = yield* RepoKind.$match(kind, {
      Canonical: ({ project }) => canonical(projects, project, pusher),
      ClaimFork: (fork) => claimFork(projects, fork, pusher, notice, audit),
      // The platform makes no repo by any other name; nothing pushes there.
      Unknown: () => Effect.succeed(refuseAll),
      // A person's working fork: only its owner pushes; their `land` judges it.
      WorkingFork: ({ handle }) =>
        Effect.succeed(sameHandle(pusher.handle, handle) ? takeAll : refuseAll),
    });

    return annotated(custody, annotations);
  });

/**
 * Custody of a push to a layer's repo. The gateway lets only the
 * layer's writers push there (`git.ts`, through `LayerGate`), so every ref
 * goes through; once the upstream took the push, the project hears the
 * head `main` moved to (`recordLayerPush`), which it admits at once or
 * through admission. A project never made takes no layer push.
 */
export const layerCustodyFor = (
  pusher: Person,
  target: LayerTarget
): Effect.Effect<Custody["Service"], never, Projects> =>
  Effect.map(Projects, (projects) =>
    custodyOf(
      () => [],
      (_repo, commands) =>
        Option.match(mainTip(commands), {
          onNone: () => Effect.succeed([]),
          onSome: ({ head }) =>
            against(projects, target.project, (api) =>
              Effect.as(
                api.recordLayerPush(pusher, { head, layer: target.layer }),
                []
              )
            ),
        })
    )
  );

/**
 * A clone or fetch of a layer's repo, for its read log: who
 * read which layer, and the commit they asked for when their request named
 * one. A project never made logs nothing.
 */
export const layerRead = (
  reader: Person,
  target: LayerTarget,
  sha: Option.Option<CommitSha>
): Effect.Effect<void, never, Projects> =>
  Projects.use((projects) => projects.get(target.project)).pipe(
    Effect.flatMap((api) =>
      api.recordLayerRead(reader, {
        layer: target.layer,
        ...Option.match(sha, {
          onNone: () => ({}),
          onSome: (read) => ({ sha: read }),
        }),
      })
    ),
    Effect.catchTag("UnknownProject", () => Effect.void)
  );
