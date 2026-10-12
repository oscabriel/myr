// Layer content is compared only for layers the answerer or a finisher reads: for
// anyone else the guard would be an oracle on a layer's content.
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

export interface GuardInput {
  readonly project: ProjectName;
  readonly answerer: Handle;
  readonly finishers: readonly Handle[];
  readonly changes: readonly Change[];
}

export interface LayerGuardsPort {
  readonly check: (
    input: GuardInput
  ) => Effect.Effect<
    readonly (PrivatePathInPublicTree | LayerContentInPublicTree)[]
  >;
}

export const LandingGuards = Context.Reference<Option.Option<LayerGuardsPort>>(
  "platform/LandingGuards",
  { defaultValue: () => Option.none() }
);

export const GuardRun = Schema.TaggedUnion({
  Blocked: { attempt: Schema.Int },
  Guarded: {
    finish: AskKind.fields.finish,
    quarantined: Schema.Array(EnvKey),
    refusals: Schema.Array(Refusal),
  },
  Moved: {},
});

export type GuardRun = typeof GuardRun.Type;

export const passes = (run: GuardRun): boolean =>
  GuardRun.guards.Guarded(run) &&
  run.refusals.length === 0 &&
  run.quarantined.length === 0;

const written = (changes: readonly Change[]) =>
  Array.dedupe(
    changes.flatMap(({ after, status }) =>
      status === "deleted" || after === undefined ? [] : [after]
    )
  );

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

    // A fork the platform cannot read leaves its files unscanned, and the tree waits. An
    // id no blob in the fork has is a submodule's pointer, with no content to scan.
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
