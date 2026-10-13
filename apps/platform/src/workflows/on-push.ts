// The class name is frozen.
import type { PushReport } from "@repo/project/project";
import type { Projects } from "@repo/project/projects";
import { Anonymous, Person } from "@repo/protocol/principal";
import { annotateInvocation, refusedWith } from "@repo/telemetry/spans";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { Data, Effect, Layer, Option, Schema } from "effect";

import { decodeEnv } from "../platform.ts";
import { telemetryOf, workerPorts } from "../ports.ts";
import { RepoKind, repoKind } from "../repo-names.ts";
import { instance, invocation } from "./instance.ts";
import { classifyPush, PushVerdict } from "./on-push/classify.ts";
import { isZero, OnPushEvent } from "./on-push/event.ts";
import { factsOf, projectFor, projectOf } from "./on-push/facts.ts";
import { StepRunner, workflowSteps } from "./step.ts";
import type { StepRetry, WorkflowSteps } from "./step.ts";

const Recorded = Schema.Array(Schema.String);

const reportOf = (
  event: OnPushEvent,
  pusher: PushReport["pusher"]
): PushReport => {
  const { after, before, ref } = event.payload;

  return {
    after,
    before: isZero(before) ? Option.none() : Option.some(before),
    eventId: event.id,
    pusher,
    ref,
    repo: event.source.repoName,
  };
};

const recordOf = (event: OnPushEvent) =>
  Effect.gen(function* () {
    const found = yield* projectFor(event);

    if (Option.isNone(found)) {
      return [];
    }

    const { api, kind } = found.value;

    const pusher = RepoKind.$is("ClaimFork")(kind)
      ? Person.make({ handle: kind.handle })
      : Anonymous.make({});

    const refusals = yield* api.recordPush(reportOf(event, pusher));

    yield* annotateInvocation(refusedWith(refusals));

    return refusals.map(({ _tag }) => _tag);
  });

class LooksStray extends Data.TaggedError("LooksStray") {}

// The platform pushes `main` before its DO records the landing, and the event can
// arrive in between: a stray verdict on the platform's own landing would ask the
// maintainers to revert it.
const strayGrace: StepRetry = {
  backoff: "exponential",
  delayMs: 15_000,
  limit: 4,
};

const verdictOf = (event: OnPushEvent) =>
  Effect.map(factsOf(event), (facts) => classifyPush(event, facts));

const classified = (event: OnPushEvent) =>
  Effect.flatMap(verdictOf(event), (verdict) =>
    PushVerdict.guards.Stray(verdict) && !isZero(verdict.after)
      ? Effect.fail(new LooksStray())
      : Effect.succeed(verdict)
  );

// A `main` still stray after `strayGrace` is the step's last failure, which the
// engine throws again, unrun, in every replay (as a defect); `settle` records the
// verdict as a value, which every replay reads back.
export const runOnPush = (
  event: OnPushEvent
): Effect.Effect<PushVerdict, never, StepRunner | Projects> =>
  Effect.gen(function* () {
    const { step } = yield* StepRunner;

    const verdict = yield* step(
      "classify",
      PushVerdict,
      classified(event),
      strayGrace
    ).pipe(
      Effect.catchCause(() => step("settle", PushVerdict, verdictOf(event)))
    );

    if (!PushVerdict.guards.Ignored(verdict)) {
      yield* step("record", Recorded, recordOf(event));
    }

    return verdict;
  });

export const runInstance = (
  env: Env,
  params: typeof OnPushEvent.Encoded,
  steps: WorkflowSteps
) =>
  Effect.gen(function* () {
    const event = yield* Schema.decodeEffect(OnPushEvent)(params);
    const config = yield* decodeEnv(env);

    const ids = Option.match(projectOf(repoKind(event.source.repoName)), {
      onNone: () => ({ sha: event.payload.after }),
      onSome: (project) => ({ project, sha: event.payload.after }),
    });

    // Its params and its env are decoded before it runs, and refuse as they are.
    return yield* runOnPush(event).pipe(
      Effect.flatMap(Schema.encodeEffect(PushVerdict)),
      invocation(ids),
      instance("OnPush.run"),
      Effect.provide(
        Layer.mergeAll(
          workerPorts(config),
          telemetryOf(config),
          workflowSteps(steps)
        )
      )
    );
  });

export class OnPush extends WorkflowEntrypoint<
  Env,
  typeof OnPushEvent.Encoded
> {
  override run(
    event: Readonly<WorkflowEvent<typeof OnPushEvent.Encoded>>,
    step: WorkflowStep
  ): Promise<typeof PushVerdict.Encoded> {
    return Effect.runPromise(runInstance(this.env, event.payload, step));
  }
}
