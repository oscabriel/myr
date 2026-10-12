import { Context } from "effect";
import type { Effect } from "effect";

import type { DraftFailed, DraftedAsk, DraftInput } from "./drafted.ts";

export class Drafter extends Context.Service<
  Drafter,
  {
    readonly draft: (
      input: DraftInput
    ) => Effect.Effect<DraftedAsk, DraftFailed>;
  }
>()("drafting/Drafter") {}
