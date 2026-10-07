/**
 * The `OnPush` Workflow, the platform's backstop (spec §5 step 9): Artifacts
 * starts one for every ref a push moved in the public namespace
 * (`triggers.events`, S1 #12 and #13), with the event's id as the instance
 * id, so a redelivered event starts nothing (S1 change 6). Each run reads
 * what the project's Durable Object knows of the push, classifies it, and
 * records what needs recording through the DO: a claim-fork push the
 * gateway never saw keeps its claim alive, and canonical `main` moved
 * without a landing becomes a `StrayPush` decision whose default is revert
 * (CM §4). It reverts nothing itself. The class name is frozen.
 */
import type { PushReport } from "@repo/project/project";
import type { Projects } from "@repo/project/projects";
import { Anonymous, Person } from "@repo/protocol/principal";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { Data, Effect, Layer, Option, Schema } from "effect";

import { decodeEnv } from "../platform.ts";
import { workerPorts } from "../ports.ts";
import { RepoKind } from "../repo-names.ts";
import { classifyPush, PushVerdict } from "./on-push/classify.ts";
import { isZero, OnPushEvent } from "./on-push/event.ts";
import { factsOf, projectFor } from "./on-push/facts.ts";
import { StepRunner, workflowSteps } from "./step.ts";
import type { StepRetry, WorkflowSteps } from "./step.ts";

/** What the gate said of a recorded push, by tag: for whoever reads the run. */
const Recorded = Schema.Array(Schema.String);

/** `event` as the project's DO records a push: under the event's own id. */
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

/**
 * `event` recorded by its project's DO, under the event's id, so the DO acts
 * on it once: a claim fork's push as its claimant's, which keeps the claim
 * alive; canonical `main`'s from nobody the platform knows, which opens the
 * `StrayPush` decision.
 */
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

    return refusals.map(({ _tag }) => _tag);
  });

/** `main` moved to a commit no landing made, as far as the DO knew when it was asked. */
class LooksStray extends Data.TaggedError("LooksStray")<{
  readonly verdict: PushVerdict;
}> {}

/**
 * How long a `main` that looks stray is asked about again before it is
 * called stray. The platform pushes `main` before its DO records the
 * landing (S1 change 1), and the event can arrive in between (S1 #14): a
 * stray verdict on the platform's own landing would ask the deciders to
 * revert it. Four more reads, 15 s to 2 min apart: about four minutes.
 */
const strayGrace: StepRetry = {
  backoff: "exponential",
  delayMs: 15_000,
  limit: 4,
};

/** What `event` means, from what the DO says of it; a stray verdict fails, so the step asks again. */
const classified = (event: OnPushEvent) =>
  Effect.flatMap(factsOf(event), (facts) => {
    const verdict = classifyPush(event, facts);

    return PushVerdict.guards.Stray(verdict)
      ? Effect.fail(new LooksStray({ verdict }))
      : Effect.succeed(verdict);
  });

/**
 * What `event` means, then what is recorded of it. Two steps, each run once
 * per instance (principle 8): `classify` (asked again during `strayGrace`
 * while `main` looks stray; a verdict that stays stray is the step's last
 * failure, so a replay asks again) and `record`, for a push the DO must
 * hear of.
 */
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
      Effect.catchTag("LooksStray", (stray) => Effect.succeed(stray.verdict))
    );

    if (!PushVerdict.guards.Ignored(verdict)) {
      yield* step("record", Recorded, recordOf(event));
    }

    return verdict;
  });

/**
 * One instance's run: its params decoded before anything else (principle
 * 2), then the env, then the program over the stage's ports and the
 * engine's own steps. It answers the verdict as JSON, the instance's output.
 */
export const runInstance = (
  env: Env,
  params: typeof OnPushEvent.Encoded,
  steps: WorkflowSteps
) =>
  Effect.gen(function* () {
    const event = yield* Schema.decodeEffect(OnPushEvent)(params);
    const config = yield* decodeEnv(env);

    const verdict = yield* runOnPush(event).pipe(
      Effect.provide(Layer.merge(workerPorts(config), workflowSteps(steps)))
    );

    return yield* Effect.orDie(Schema.encodeEffect(PushVerdict)(verdict));
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
