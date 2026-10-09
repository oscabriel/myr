/**
 * The `Drafter` port: the platform's agent that drafts an ask from a want.
 * Adapters: `/memory` (a scripted queue, for tests and the web's dev world)
 * and `/binding` (Workers AI through the `AI` binding).
 */
import { Context } from "effect";
import type { Effect } from "effect";

import type { DraftFailed, DraftedAsk, DraftInput } from "./drafted.ts";

export class Drafter extends Context.Service<
  Drafter,
  {
    /** One attempt: the drafted ask's fields, or why the model gave none. */
    readonly draft: (
      input: DraftInput
    ) => Effect.Effect<DraftedAsk, DraftFailed>;
  }
>()("drafting/Drafter") {}
