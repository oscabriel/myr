import { Effect, Layer, Ref } from "effect";

import { MailFailed, Mailer } from "../mailer.ts";
import type { Mail } from "../mailer.ts";

// Keeps every mail sent, newest last; `failing` makes each send fail.
export const MailerMemory = {
  make: (options: { readonly failing?: boolean } = {}) =>
    Effect.gen(function* () {
      const sent = yield* Ref.make<readonly Mail[]>([]);

      const layer = Layer.succeed(
        Mailer,
        Mailer.of({
          send: (mail) =>
            options.failing === true
              ? Effect.fail(new MailFailed())
              : Ref.update(sent, (all) => [...all, mail]),
        })
      );

      return { layer, sent: Ref.get(sent) };
    }),
};
