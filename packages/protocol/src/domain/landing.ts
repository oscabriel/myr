import { Schema } from "effect";

import { AskId, Handle, LandedSha, ProjectName, RequestId } from "../ids.ts";
import { Verdict } from "./answer.ts";
import { AgentTrailer, Credit } from "./credit.ts";

export const LandingView = Schema.Struct({
  ask: Schema.optionalKey(AskId),
  assisted: Schema.Array(AgentTrailer),
  author: Handle,
  credits: Schema.Array(Credit),
  heldBackTrailer: Schema.optionalKey(Schema.NonEmptyString),
  landedAt: Schema.DateTimeUtcFromString,
  opened: Schema.optionalKey(AskId),
  parent: Schema.optionalKey(LandedSha),
  project: ProjectName,
  requestId: Schema.optionalKey(RequestId),
  sha: LandedSha,
  verdict: Schema.optionalKey(Verdict),
});

export type LandingView = typeof LandingView.Type;
