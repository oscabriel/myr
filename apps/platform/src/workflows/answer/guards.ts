/**
 * The `Answer` Workflow's landing guards: before
 * any check runs on an answer's merged tree, the tree is checked again for
 * what may never enter a public tree, as it stands now (a layer may have
 * grown since the push was admitted at stage 1):
 *
 * - a path in a layer's path set: `PrivatePathInPublicTree`;
 * - a file whose blob is a layer's blob, only when the answerer or a
 *   finisher reads that layer (only they could have copied it; on anyone
 *   else the guard would be an oracle): `LayerContentInPublicTree`;
 * - a file holding a stored write-only value, by the project's own scan
 *   (`ProjectApi.scanForValues`, where the values are; never in the
 *   sandbox): the item is quarantined, for the deciders alone.
 *
 * The layer guards need the layers' contents, which only the visibility
 * cartridge reaches, so they sit behind `LandingGuards`, a port whose
 * default is no guards at all: without the cartridge there are no layers
 * and no stored values, and the program takes no guards step (its steps
 * are the ones it always took).
 */
import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { Change } from "@repo/project/landing";
import { LandingState } from "@repo/project/landing";
import { Projects } from "@repo/project/projects";
import { AskKind } from "@repo/protocol/domain/kind";
import { EnvKey } from "@repo/protocol/ids";
import type {
  Handle,
  ProjectName,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import type {
  LayerContentInPublicTree,
  PrivatePathInPublicTree,
} from "@repo/protocol/refusal";
import { Array, Context, Effect, Option, Schema } from "effect";

import { StepRunner } from "../step.ts";

/** One answer's merged change set, and the people accountable for it. */
export interface GuardInput {
  readonly project: ProjectName;
  readonly answerer: Handle;
  /** Deciders whose finish put commits of their own on the answer. */
  readonly finishers: readonly Handle[];
  readonly changes: readonly Change[];
}

/** The no-write-down guards on a merged change set, as the visibility cartridge runs them. */
export interface LayerGuardsPort {
  readonly check: (
    input: GuardInput
  ) => Effect.Effect<
    readonly (PrivatePathInPublicTree | LayerContentInPublicTree)[]
  >;
}

/**
 * How the Workflow reaches the layer guards: none by default, a platform
 * without typed visibility. The visibility cartridge provides them
 * (`apps/platform/src/visibility/held-back.ts`).
 */
export const LandingGuards = Context.Reference<Option.Option<LayerGuardsPort>>(
  "platform/LandingGuards",
  { defaultValue: () => Option.none() }
);

/** What the guards step came to, kept as its value: no names but public ones. */
export const GuardRun = Schema.TaggedUnion({
  /** An added blob could not be read: the guards try again later, never counted. */
  Blocked: { attempt: Schema.Int },
  /** The guards' refusals, and the items whose stored value an added file holds. */
  Guarded: {
    finish: AskKind.fields.finish,
    quarantined: Schema.Array(EnvKey),
    refusals: Schema.Array(Refusal),
  },
  /** The answer no longer waits on checks of this tree. */
  Moved: {},
});

export type GuardRun = typeof GuardRun.Type;

/**
 * Whether the guards let the tree on to its checks: only when they ran on
 * it and found nothing. A blocked run waits, and a moved one stops.
 */
export const passes = (run: GuardRun): boolean =>
  GuardRun.guards.Guarded(run) &&
  run.refusals.length === 0 &&
  run.quarantined.length === 0;

/** Files the answer puts into the public tree: added, or modified to a new blob. */
const written = (changes: readonly Change[]) =>
  Array.dedupe(
    changes.flatMap(({ after, status }) =>
      status === "deleted" || after === undefined ? [] : [after]
    )
  );

/**
 * The guards on `tree`, as the answer's run stands: the cartridge's layer
 * guards over its change set and the people accountable for it, then each
 * blob it writes, read from its fork, through the project's scan.
 */
const guarded = (
  params: { readonly project: ProjectName; readonly requestId: RequestId },
  tree: TreeSha,
  port: LayerGuardsPort
): Effect.Effect<GuardRun, never, Projects | RepoHost> =>
  Effect.gen(function* () {
    const api = yield* Projects.use((projects) =>
      projects.get(params.project)
    ).pipe(Effect.orDie);

    const run = yield* api.answer(params.requestId);

    const found = Option.flatMap(run, (each) =>
      LandingState.guards.Checking(each.state) && each.state.tree === tree
        ? Option.some({ finish: each.finish, state: each.state })
        : Option.none()
    );

    if (Option.isNone(found)) {
      return GuardRun.cases.Moved.make({});
    }

    const { finish, state } = found.value;
    const { request } = state;

    const refusals = yield* port.check({
      answerer: request.answerer,
      changes: state.changes,
      finishers: request.credits
        .filter(({ role }) => role === "Finished-by")
        .map(({ handle }) => handle),
      project: params.project,
    });

    const host = yield* RepoHost;

    // A fork the platform cannot read leaves its files unscanned: the guards
    // try again later, and never let the tree by. An id no blob in the fork
    // has is a submodule's pointer, a commit in another repo (`tree-diff`):
    // it brings no content of its own into the tree, so there is none to scan.
    const read = yield* Effect.option(
      Effect.forEach(written(state.changes), (blob) =>
        host.readBlob(request.fork, ObjectId.make(blob))
      )
    );

    if (Option.isNone(read)) {
      return GuardRun.cases.Blocked.make({ attempt: state.attempt });
    }

    const held = yield* Effect.forEach(Array.getSomes(read.value), (blob) =>
      api.scanForValues({ blob })
    );

    return GuardRun.cases.Guarded.make({
      finish,
      quarantined: Array.dedupe(Array.getSomes(held)),
      refusals,
    });
  });

/**
 * The guards on the tree the answer waits to have checked, as a durable
 * step named for the attempt; none when no cartridge provides them.
 */
export const guards = (
  params: { readonly project: ProjectName; readonly requestId: RequestId },
  tree: TreeSha,
  attempt: number
): Effect.Effect<
  Option.Option<GuardRun>,
  never,
  Projects | RepoHost | StepRunner
> =>
  Effect.gen(function* () {
    const plugged = yield* LandingGuards;

    if (Option.isNone(plugged)) {
      return Option.none();
    }

    const { step } = yield* StepRunner;

    return Option.some(
      yield* step(
        `guards#${attempt}`,
        GuardRun,
        guarded(params, tree, plugged.value)
      )
    );
  });
