import type { RefName, RepoName } from "@repo/artifacts/repo-host";
import type { CommitSha } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { Context } from "effect";
import type { Array, Effect, Option } from "effect";

/** One ref in a push: `None` for `from` creates it, for `to` deletes it. */
export interface Command {
  readonly ref: RefName;
  readonly from: Option.Option<CommitSha>;
  readonly to: Option.Option<CommitSha>;
}

/**
 * Who may push what. A push lands whole or not at all at the gateway: any
 * refusal turns every ref in it away, and each refusal reaches the pusher in
 * git's own output.
 */
export class Custody extends Context.Service<
  Custody,
  {
    /** Before anything reaches the upstream; a refusal forwards nothing. */
    readonly admit: (
      repo: RepoName,
      commands: Array.NonEmptyReadonlyArray<Command>
    ) => Effect.Effect<readonly Refusal[]>;
    /**
     * After the upstream took the push, such as stage 0–1 over the
     * answerer's fork; a refusal reaches the pusher though the fork keeps it.
     */
    readonly review: (
      repo: RepoName,
      commands: Array.NonEmptyReadonlyArray<Command>
    ) => Effect.Effect<readonly Refusal[]>;
  }
>()("git/Custody") {}
