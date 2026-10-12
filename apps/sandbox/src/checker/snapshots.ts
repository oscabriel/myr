import { Context } from "effect";
import type { Effect } from "effect";

import type { BoxFailed } from "../box.ts";

export class Snapshots extends Context.Service<
  Snapshots,
  {
    readonly save: (key: string) => Effect.Effect<void, BoxFailed>;
    /** After a restore the workspace is the snapshot's: check the tree out again. */
    readonly restore: (key: string) => Effect.Effect<boolean, BoxFailed>;
  }
>()("sandbox/Snapshots") {}
