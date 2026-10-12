import type { RefName, RepoName } from "@repo/artifacts/repo-host";
import type { CommitSha } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { Context } from "effect";
import type { Array, Effect, Option } from "effect";

export interface Command {
  readonly ref: RefName;
  readonly from: Option.Option<CommitSha>;
  readonly to: Option.Option<CommitSha>;
}

/** A push lands whole or not at all at the gateway: any refusal turns every ref away. */
export class Custody extends Context.Service<
  Custody,
  {
    readonly admit: (
      repo: RepoName,
      commands: Array.NonEmptyReadonlyArray<Command>
    ) => Effect.Effect<readonly Refusal[]>;
    /** A refusal here reaches the pusher though the upstream already took the push. */
    readonly review: (
      repo: RepoName,
      commands: Array.NonEmptyReadonlyArray<Command>
    ) => Effect.Effect<readonly Refusal[]>;
  }
>()("git/Custody") {}
