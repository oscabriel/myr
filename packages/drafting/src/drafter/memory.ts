import { Context, Effect, Layer, Ref, Schema } from "effect";

import { DraftFailed } from "../drafted.ts";
import type { DraftedAsk, DraftInput } from "../drafted.ts";
import { Drafter } from "../drafter.ts";

const isFailure = Schema.is(DraftFailed);

export class DraftsAsked extends Context.Service<
  DraftsAsked,
  { readonly inputs: Effect.Effect<readonly DraftInput[]> }
>()("drafting/DraftsAsked") {}

export const DrafterMemory = (
  script: readonly (DraftedAsk | DraftFailed)[]
): Layer.Layer<Drafter | DraftsAsked> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const left = yield* Ref.make(script);
      const asked = yield* Ref.make<readonly DraftInput[]>([]);

      const draft = (input: DraftInput) =>
        Effect.gen(function* () {
          yield* Ref.update(asked, (all) => [...all, input]);

          const [next, ...rest] = yield* Ref.get(left);

          if (next === undefined) {
            return yield* Effect.die("the memory drafter's script ran out");
          }

          yield* Ref.set(left, rest);

          return isFailure(next) ? yield* next : next;
        });

      return Context.make(Drafter, Drafter.of({ draft })).pipe(
        Context.add(DraftsAsked, DraftsAsked.of({ inputs: Ref.get(asked) }))
      );
    })
  );
