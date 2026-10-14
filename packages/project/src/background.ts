import { Context } from "effect";
import type { Effect } from "effect";

export interface BackgroundApi {
  /** Runs the work, which a call asked for, once the call can answer. */
  readonly run: (work: Effect.Effect<void>) => Effect.Effect<void>;
}

/**
 * The start of an answer run waits on a Workflow's admission, which a push's
 * reply need not: a host that lives on past a call (a Durable Object) runs it
 * in a fiber of its own. The default runs the work inline, so the start is
 * done when the call returns.
 */
export const Background = Context.Reference<BackgroundApi>(
  "project/Background",
  { defaultValue: () => ({ run: (work) => work }) }
);
