/**
 * What OnPush asks a project's Durable Object before it classifies a push
 * event: whether canonical `main`'s new commit is a landing the platform
 * made (`landing(platform, sha)`), and whether the gateway recorded a claim
 * fork taking the pushed commit. Each read is asked only of the events it
 * can change the verdict of.
 */
import { platformHandle } from "@repo/project/attention/effects";
import type { ProjectApi } from "@repo/project/project";
import { keptEvents } from "@repo/project/project-store";
import { Projects } from "@repo/project/projects";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { AskId, CommitSha, ProjectName } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Effect, Option } from "effect";

import { RepoKind, repoKind } from "../../repo-names.ts";
import { isBookkeeping, mainRef } from "./classify.ts";
import type { PushFacts } from "./classify.ts";
import { isZero } from "./event.ts";
import type { OnPushEvent } from "./event.ts";

/** The platform itself, reading a project's public record. */
const platform = Person.make({ handle: platformHandle });

/** The project a repo belongs to, when its name says. */
const projectOf = (kind: RepoKind): Option.Option<ProjectName> =>
  RepoKind.$match(kind, {
    Canonical: ({ project }) => Option.some(project),
    ClaimFork: ({ project }) => Option.some(project),
    Unknown: () => Option.none(),
    WorkingFork: ({ project }) => Option.some(project),
  });

/** `sha` as a landing the platform made on the project's `main`, or none. */
const landedOf = (api: ProjectApi, sha: CommitSha) =>
  Effect.map(Effect.isSuccess(api.landing(platform, sha)), (landed) =>
    landed ? new Set([sha]) : new Set<CommitSha>()
  );

/**
 * Whether the gateway recorded the claim's fork taking `head`: recording a
 * claimant's push keeps the claim alive and emits `Pushed`, which the
 * project keeps among its newest events.
 */
const seenBy = (
  api: ProjectApi,
  push: { readonly ask: AskId; readonly head: CommitSha }
) =>
  Effect.map(api.events(0, keptEvents), (rows) =>
    rows.some(
      ({ event }) =>
        ProjectEvent.guards.Pushed(event) &&
        event.ask === push.ask &&
        event.head === push.head
    )
  );

const nothing = (repo: RepoKind): PushFacts => ({
  landed: new Set(),
  repo,
  seen: false,
});

/** The project and the API of the repo `event` is about, when the platform has that project. */
export const projectFor = (event: OnPushEvent) =>
  Effect.gen(function* () {
    const kind = repoKind(event.source.repoName);
    const project = projectOf(kind);

    if (Option.isNone(project)) {
      return Option.none();
    }

    const api = yield* Effect.option(
      Projects.use((projects) => projects.get(project.value))
    );

    return Option.map(api, (found) => ({ api: found, kind }));
  });

/** What the project's Durable Object says about `event`. */
export const factsOf = (
  event: OnPushEvent
): Effect.Effect<PushFacts, never, Projects> =>
  Effect.gen(function* () {
    const { after, ref } = event.payload;
    const found = yield* projectFor(event);

    if (Option.isNone(found)) {
      return nothing(RepoKind.Unknown());
    }

    const { api, kind } = found.value;
    const moved = !isZero(after) && !isBookkeeping(ref);

    return yield* RepoKind.$match(kind, {
      Canonical: () =>
        moved && ref === mainRef
          ? Effect.map(landedOf(api, after), (landed) => ({
              ...nothing(kind),
              landed,
            }))
          : Effect.succeed(nothing(kind)),
      ClaimFork: ({ ask }) =>
        moved
          ? Effect.map(seenBy(api, { ask, head: after }), (seen) => ({
              ...nothing(kind),
              seen,
            }))
          : Effect.succeed(nothing(kind)),
      Unknown: () => Effect.succeed(nothing(kind)),
      WorkingFork: () => Effect.succeed(nothing(kind)),
    });
  });
