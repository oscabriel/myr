/**
 * The `Drafter` in memory: each call takes the next answer from a script
 * (a drafted ask, or the failure to give), and every input is kept for the
 * test to read (`DraftsAsked`). A call past the script's end is the test's
 * defect.
 */
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { DraftFailed } from "../drafted.ts";
import type { DraftedAsk, DraftInput } from "../drafted.ts";
import { Drafter } from "../drafter.ts";

const isFailure = Schema.is(DraftFailed);

/** What the memory drafter was asked, in order. */
export class DraftsAsked extends Context.Service<
  DraftsAsked,
  { readonly inputs: Effect.Effect<readonly DraftInput[]> }
>()("drafting/DraftsAsked") {}

/** A drafter that answers `script` in order, one entry per call. */
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
