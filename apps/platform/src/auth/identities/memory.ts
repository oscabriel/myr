import { Handle } from "@repo/protocol/ids";
import { Effect, Layer, Option, Ref } from "effect";

import { handleKey } from "../accounts.ts";
import { Identities, IdentityTaken } from "../identities.ts";

const keyOf = (provider: string, subject: string) => `${provider}\n${subject}`;

export const IdentitiesMemory = {
  layer: Layer.effect(
    Identities,
    Effect.gen(function* () {
      const links = yield* Ref.make(new Map<string, string>());

      return Identities.of({
        handleOf: (provider, subject) =>
          Ref.get(links).pipe(
            Effect.map((linked) =>
              Option.map(
                Option.fromUndefinedOr(linked.get(keyOf(provider, subject))),
                (key) => Handle.make(key)
              )
            )
          ),
        link: (provider, subject, handle) =>
          Ref.modify(links, (linked) => {
            const key = keyOf(provider, subject);

            const held = linked.get(key);

            if (held === undefined) {
              return [true, new Map(linked).set(key, handleKey(handle))];
            }

            return [held === handleKey(handle), linked];
          }).pipe(
            Effect.filterOrFail(
              (linked) => linked,
              () => new IdentityTaken({ provider, subject })
            ),
            Effect.asVoid
          ),
      });
    })
  ),
};
