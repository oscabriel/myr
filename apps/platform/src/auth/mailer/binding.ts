// Cloudflare Email Service's `send_email` binding. The sending domain is
// the brand's, onboarded for sending on the account.
import { Brand } from "@repo/brand";
import { Effect, Layer } from "effect";

import { disposed } from "../../adapters/rpc-result.ts";
import { MailFailed, Mailer } from "../mailer.ts";

export const MAIL_FROM = {
  email: `no-reply@${Brand.domain}`,
  name: Brand.name,
} as const;

export const MailerBinding = (binding: SendEmail) =>
  Layer.succeed(
    Mailer,
    Mailer.of({
      send: (mail) =>
        Effect.tryPromise({
          catch: () => new MailFailed(),
          try: () =>
            binding.send({
              from: MAIL_FROM,
              subject: mail.subject,
              text: mail.text,
              to: mail.to,
            }),
        }).pipe(Effect.flatMap(disposed), Effect.asVoid),
    })
  );
