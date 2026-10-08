/**
 * What setup installed, kept for the next check of the same project with the
 * same lockfile, so setup runs once per lockfile rather than once per check.
 * A snapshot is taken right after setup and never later: held-back files are
 * written only after it (`@repo/checks/phases`).
 *
 * Adapters: `checker/sdk.ts` over Container snapshots; tests keep the keys in
 * memory (`test/fake-box.ts`).
 */
import { Context } from "effect";
import type { Effect } from "effect";

import type { BoxFailed } from "../box.ts";

export class Snapshots extends Context.Service<
  Snapshots,
  {
    /** Keeps the container's files under `key`, replacing any kept there. */
    readonly save: (key: string) => Effect.Effect<void, BoxFailed>;
    /**
     * Puts back the files kept under `key`, if any: `false` when there are
     * none, and the container is untouched. After a restore the workspace is
     * the snapshot's, so the caller checks its own tree out again.
     */
    readonly restore: (key: string) => Effect.Effect<boolean, BoxFailed>;
  }
>()("sandbox/Snapshots") {}
