import { Schema } from "effect";

import { AskId, Handle, LandedSha, ProjectName, RequestId } from "../ids.ts";
import { Verdict } from "./answer.ts";
import { AgentTrailer, Credit } from "./credit.ts";

/**
 * A landing: the platform's commit of a checked tree to main, with the credit
 * trailers that name every person in it.
 */
export const LandingView = Schema.Struct({
  /** The ask it answers; absent for a decider's own landing and the first adoption. */
  ask: Schema.optionalKey(AskId),
  assisted: Schema.Array(AgentTrailer),
  /** The accountable person. */
  author: Handle,
  credits: Schema.Array(Credit),
  /** `Held-back: <area> <passed>/<total> @ <suite>`, when held-back checks judged it. */
  heldBackTrailer: Schema.optionalKey(Schema.NonEmptyString),
  landedAt: Schema.DateTimeUtcFromString,
  /** Main before it; absent for the first adoption (the initializer's first push, or an import's tip). */
  parent: Schema.optionalKey(LandedSha),
  project: ProjectName,
  requestId: Schema.optionalKey(RequestId),
  sha: LandedSha,
  verdict: Schema.optionalKey(Verdict),
});

export type LandingView = typeof LandingView.Type;
