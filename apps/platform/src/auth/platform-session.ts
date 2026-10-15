// The platform's own sign-in, kept between grants: a person who signed in once
// for any client is asked only to continue for the next, never for their
// password again. It names an account and the password it was signed in
// under, so a reset or a change of password ends every session at once.
import { Handle } from "@repo/protocol/ids";
import { Duration, Effect, Option, Schema } from "effect";
import type { Redacted } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpServerResponse } from "effect/http";

import { Accounts } from "./accounts.ts";
import type { Account } from "./accounts.ts";
import { sealing } from "./state.ts";

export const SESSION_COOKIE = "__Host-platform-session";

export const SESSION_LIFETIME = Duration.days(30);

// `Lax`, not `Strict`: a client sends the person here by a top-level link, and the cookie must come with it.
export const sessionCookie = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
} as const;

const PlatformSession = Schema.Struct({ handle: Handle, stamp: Schema.String });

const sessions = sealing("platform-session", PlatformSession, SESSION_LIFETIME);

const encodeStamp = Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url);

// A digest of the password hash, never the hash: the cookie's payload is signed, not hidden.
const stampOf = (account: Account) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(account.hash))
  ).pipe(
    Effect.flatMap((digest) => encodeStamp(new Uint8Array(digest))),
    Effect.map((stamp) => stamp.slice(0, 22)),
    Effect.orDie
  );

/**
 * The account a request's session names, while the account stands and its
 * password is the one it was signed in under. A session that does not open,
 * has expired or no longer fits reads as none, the same as no cookie, so a
 * forged one learns nothing.
 */
export const sessionAccount = (
  key: Redacted.Redacted,
  request: HttpServerRequest.HttpServerRequest
) =>
  Effect.gen(function* () {
    const sealed = request.cookies[SESSION_COOKIE];

    if (sealed === undefined || sealed === "") {
      return Option.none<Account>();
    }

    const opened = yield* sessions.open(key, sealed).pipe(Effect.option);

    if (Option.isNone(opened)) {
      return Option.none<Account>();
    }

    const accounts = yield* Accounts;

    const account = yield* accounts.find(opened.value.handle);

    if (Option.isNone(account)) {
      return Option.none<Account>();
    }

    const stamp = yield* stampOf(account.value);

    return stamp === opened.value.stamp ? account : Option.none<Account>();
  });

export const hasSessionCookie = (
  request: HttpServerRequest.HttpServerRequest
) => request.cookies[SESSION_COOKIE] !== undefined;

export const withSession =
  (key: Redacted.Redacted, account: Account) =>
  (response: HttpServerResponse.HttpServerResponse) =>
    Effect.gen(function* () {
      const sealed = yield* sessions.seal(key, {
        handle: account.handle,
        stamp: yield* stampOf(account),
      });

      return yield* response.pipe(
        HttpServerResponse.setCookie(SESSION_COOKIE, sealed, {
          ...sessionCookie,
          maxAge: SESSION_LIFETIME,
        }),
        Effect.orDie
      );
    });

export const withoutSession = (
  response: HttpServerResponse.HttpServerResponse
) =>
  response.pipe(
    HttpServerResponse.setCookie(SESSION_COOKIE, "", {
      ...sessionCookie,
      maxAge: 0,
    }),
    Effect.orDie
  );
