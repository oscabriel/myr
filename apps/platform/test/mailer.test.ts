import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Effect } from "effect";

import { Email } from "../src/auth/accounts.ts";
import { MailFailed, Mailer } from "../src/auth/mailer.ts";
import { MAIL_FROM, MailerBinding } from "../src/auth/mailer/binding.ts";
import { MailerMemory } from "../src/auth/mailer/memory.ts";

const mail = {
  subject: "123456 is your code",
  text: "Your code is 123456.",
  to: Email.make("alice@mail.example"),
};

const sendWith = (binding: SendEmail) =>
  Mailer.use((mailer) => mailer.send(mail)).pipe(
    Effect.provide(MailerBinding(binding))
  );

describe("the mailer over Email Service's binding", () => {
  it.effect(
    "sends plain text from the brand's no-reply address, to the one address",
    () =>
      Effect.gen(function* () {
        const sent: unknown[] = [];

        const binding: SendEmail = {
          send: (message: EmailMessage | EmailMessageBuilder) => {
            sent.push(message);

            return Promise.resolve({ messageId: "message-1" });
          },
        };

        yield* sendWith(binding);

        expect(MAIL_FROM).toStrictEqual({
          email: `no-reply@${Brand.domain}`,
          name: Brand.name,
        });
        expect(sent).toStrictEqual([
          {
            from: MAIL_FROM,
            subject: mail.subject,
            text: mail.text,
            to: mail.to,
          },
        ]);
      })
  );

  it.effect("fails as MailFailed when the binding refuses", () =>
    Effect.gen(function* () {
      const binding: SendEmail = {
        send: () => Promise.reject(new Error("E_SENDER_NOT_VERIFIED")),
      };

      expect(yield* Effect.flip(sendWith(binding))).toStrictEqual(
        new MailFailed()
      );
    })
  );
});

describe("the mailer in memory", () => {
  it.effect(
    "keeps each mail in the order sent, or fails each when told to",
    () =>
      Effect.gen(function* () {
        const kept = yield* MailerMemory.make();

        const failing = yield* MailerMemory.make({ failing: true });

        yield* Mailer.use((mailer) => mailer.send(mail)).pipe(
          Effect.provide(kept.layer)
        );

        expect(yield* kept.sent).toStrictEqual([mail]);
        expect(
          yield* Effect.flip(
            Mailer.use((mailer) => mailer.send(mail)).pipe(
              Effect.provide(failing.layer)
            )
          )
        ).toStrictEqual(new MailFailed());
        expect(yield* failing.sent).toStrictEqual([]);
      })
  );
});
