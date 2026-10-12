// The one way sign-in reaches a person outside the browser: a plain-text
// mail, from the platform's own address, with a code in it.
import { Context, Data } from "effect";
import type { Effect } from "effect";

import type { Email } from "./accounts.ts";

export interface Mail {
  readonly subject: string;
  readonly text: string;
  readonly to: Email;
}

export class MailFailed extends Data.TaggedError("MailFailed") {}

export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (mail: Mail) => Effect.Effect<void, MailFailed> }
>()("platform/Mailer") {}
