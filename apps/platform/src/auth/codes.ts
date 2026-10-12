// A mailed code proves a person reads an address. The code itself is kept
// nowhere: the form carries its HMAC under the cookie key, bound to what it
// is for and to the address, so the browser holding the form cannot guess it
// offline, and a code mailed for one purpose or address opens no other.
import { Effect, Option, Redacted, Schema } from "effect";

import { emailKey } from "./accounts.ts";
import type { Email } from "./accounts.ts";

export const CODE_DIGITS = 6;

const SPACE = 10 ** CODE_DIGITS;

// The largest multiple of SPACE a Uint32 holds, so every code is as likely.
const FAIR = Math.floor(2 ** 32 / SPACE) * SPACE;

export const freshCode = Effect.sync(() => {
  const draw = new Uint32Array(1);

  do {
    crypto.getRandomValues(draw);
  } while ((draw[0] ?? FAIR) >= FAIR);

  return ((draw[0] ?? 0) % SPACE).toString().padStart(CODE_DIGITS, "0");
});

export type CodePurpose = "sign-up" | "add-email" | "reset";

const Tag = Schema.Uint8ArrayFromBase64Url;

const encodeTag = Schema.encodeEffect(Tag);

const decodeTag = Schema.decodeEffect(Tag);

const utf8 = (text: string) => new TextEncoder().encode(text);

const hmacKey = (key: Redacted.Redacted) =>
  Effect.promise(() =>
    crypto.subtle.importKey(
      "raw",
      utf8(Redacted.value(key)),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign", "verify"]
    )
  );

const bound = (purpose: CodePurpose, email: Email, code: string) =>
  utf8(`code.${purpose}.${emailKey(email)}.${code}`);

export const codeTag = (
  key: Redacted.Redacted,
  purpose: CodePurpose,
  email: Email,
  code: string
) =>
  Effect.gen(function* () {
    const hmac = yield* hmacKey(key);

    const signature = yield* Effect.promise(() =>
      crypto.subtle.sign("HMAC", hmac, bound(purpose, email, code))
    );

    return yield* encodeTag(new Uint8Array(signature)).pipe(Effect.orDie);
  });

// A tag no code opens, for a form that must look like one that mailed a code.
export const deadTag = Effect.sync(() =>
  crypto.getRandomValues(new Uint8Array(32))
).pipe(Effect.flatMap(encodeTag), Effect.orDie);

// People paste codes with spaces or dashes in them.
const typed = (entered: string) => entered.replaceAll(/[\s-]/gu, "");

export const codeMatches = (
  key: Redacted.Redacted,
  purpose: CodePurpose,
  email: Email,
  tag: string,
  entered: string
) =>
  Effect.gen(function* () {
    const code = typed(entered);

    if (!new RegExp(`^\\d{${CODE_DIGITS}}$`, "u").test(code)) {
      return false;
    }

    const expected = yield* decodeTag(tag).pipe(Effect.option);

    if (Option.isNone(expected)) {
      return false;
    }

    const hmac = yield* hmacKey(key);

    return yield* Effect.promise(() =>
      crypto.subtle.verify(
        "HMAC",
        hmac,
        new Uint8Array(expected.value),
        bound(purpose, email, code)
      )
    );
  });
