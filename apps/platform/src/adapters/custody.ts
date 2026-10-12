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

const mainRef = "refs/heads/main";

export type Notice = (line: string) => Effect.Effect<void>;

// A request id holds 64 characters, so the head comes first and is never cut.
export const pushRequestId = (pusher: Handle, head: CommitSha) =>
  RequestId.make(`push-${head}-${pusher.toLowerCase()}`.slice(0, 64));

const pushEventId = (repo: RepoName, head: CommitSha) => `push-${repo}-${head}`;

const directPushes = (commands: readonly Command[]) =>
  commands.map(({ ref }) => new DirectPush({ ref }));

const branchPrefix = "refs/heads/";

// Every ref but a branch is the platform's (notes, merge refs) or no one's (tags).
const branchesOnly = (commands: readonly Command[]): readonly Refusal[] =>
  commands.flatMap(({ ref }) =>
    ref.startsWith(branchPrefix) ? [] : [new DirectPush({ ref })]
  );

const mainTip = (commands: readonly Command[]) =>
  Option.flatMap(
    Array.findFirst(commands, ({ ref }) => ref === mainRef),
    (command) =>
      Option.map(command.to, (head) => ({ from: command.from, head }))
  );

const against = (
  projects: Projects["Service"],
  project: ProjectName,
  judge: (api: ProjectApi) => Effect.Effect<readonly Refusal[]>
): Effect.Effect<readonly Refusal[]> =>
  projects.get(project).pipe(
    Effect.flatMap(judge),
    Effect.catchTag("UnknownProject", (refused) => Effect.succeed([refused]))
  );

const custodyOf = (
  admit: (commands: readonly Command[]) => readonly Refusal[],
  review: Custody["Service"]["review"]
) =>
  Custody.of({
    admit: (_repo, commands) => Effect.succeed(admit(commands)),
    review,
  });

// A project never made has no first pusher: custody fails closed.
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

const claimOn = (api: ProjectApi, person: Person, ask: AskId) =>
  Effect.map(api.status(person), ({ claims }) =>
    Array.findFirst(claims, (claim) => claim.ask === ask)
  );

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

const claimFork = (
  projects: Projects["Service"],
  fork: Extract<RepoKind, { readonly _tag: "ClaimFork" }>,
  pusher: Person,
  notice: Notice,
  audit: Option.Option<HarnessAudit>
) =>
  Effect.gen(function* () {
    const isClaimant = sameHandle(pusher.handle, fork.handle);

    // A maintainer finishes an answer by pushing onto its fork.
    const refused = yield* against(projects, fork.project, (api) =>
      isClaimant
        ? holds(api, pusher, fork.ask)
        : Effect.map(Effect.isSuccess(api.today(pusher)), (decides) =>
            decides ? [] : [NotClaimed.of(fork.ask)]
          )
    );

    return custodyOf(
      (commands) => [...branchesOnly(commands), ...refused],
      // A maintainer's commits are judged by `<cli> finish`, not by the push.
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

// `admit` stays synchronous: the gateway's body locks the moment the fiber yields.
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

const ownBranches = custodyOf(branchesOnly, () => Effect.succeed([]));

export const refuseAll = custodyOf(directPushes, (_repo, commands) =>
  Effect.succeed(directPushes(commands))
);

// `audit` is metadata only: who pushes is the token's person, never the username.
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
        Effect.succeed(
          sameHandle(pusher.handle, handle) ? ownBranches : refuseAll
        ),
    });

    return annotated(custody, annotations);
  });

// The gateway lets only the layer's writers push here, so every ref goes through.
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
