// What every Workflow instance runs under. The engine logs nothing of a run
// that rejects and traces no Workflow, so the instance's own span is the
// trace's only view into it, and its defects are reported here, once.
import { reportDefects } from "@repo/telemetry/defects";
import { withInvocation } from "@repo/telemetry/spans";
import type { InvocationIds } from "@repo/telemetry/spans";
import { Effect } from "effect";

/** The whole instance, its params' decoding included. */
export const instance =
  (name: string) =>
  <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
    program.pipe(Effect.orDie, reportDefects, Effect.withSpan(name));

/** The run its params name: a defect's report carries the ids, as each line does. */
export const invocation =
  (ids: InvocationIds) =>
  <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
    program.pipe(Effect.orDie, reportDefects, withInvocation(ids));
