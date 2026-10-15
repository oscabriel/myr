import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Option, Redacted, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { OAuthSessions } from "../src/adapters/sessions-oauth.ts";
import { Accounts, Email } from "../src/auth/accounts.ts";
import type { Account } from "../src/auth/accounts.ts";
import { AccountsMemory } from "../src/auth/accounts/memory.ts";
import { SignInAttempts } from "../src/auth/attempts.ts";
import { SignInAttemptsMemory } from "../src/auth/attempts/memory.ts";
import { cliClientMetadata } from "../src/auth/cli-client.ts";
import { codeMatches, codeTag, deadTag, freshCode } from "../src/auth/codes.ts";
import type { CodePurpose } from "../src/auth/codes.ts";
import { ACCOUNT_PATHS, SESSION_PATHS } from "../src/auth/pages.ts";
import {
  hashPassword,
  hashPasswordWith,
  PasswordHash,
  verifyPassword,
} from "../src/auth/password.ts";
import { sessionAccount, withSession } from "../src/auth/platform-session.ts";
import { tokenReader } from "../src/auth/provider.ts";
import { openState, sealState, SignInFailed } from "../src/auth/state.ts";
import type { PendingSignIn } from "../src/auth/state.ts";
import worker from "../src/worker.ts";
import {
  cookieKey as cookieKeyText,
  fakeEnv,
  passwordPepper,
} from "./fake-env.ts";
import {
  authorizeUrl,
  cliClient,
  codeOf,
  cspOf,
  formOf,
  namedPerson,
  origin,
  port,
  post,
  signInWorld,
  tokenRequest,
} from "./oauth.fixtures.ts";
import type { World } from "./oauth.fixtures.ts";

const pepper = Redacted.make(passwordPepper);

const password = Redacted.make("correct horse battery");

describe("a stored password", () => {
  it.effect("verifies the password it was made from, and no other", () =>
    Effect.gen(function* () {
      const stored = yield* hashPassword(pepper, password);

      expect(yield* verifyPassword(pepper, password, stored)).toStrictEqual({
        needsRehash: false,
        ok: true,
      });
      expect(
        yield* verifyPassword(pepper, Redacted.make("wrong horse"), stored)
      ).toStrictEqual({ needsRehash: false, ok: false });
    })
  );

  it.effect("needs the same pepper to verify", () =>
    Effect.gen(function* () {
      const stored = yield* hashPassword(pepper, password);

      const other = Redacted.make("another-pepper-0123456789abcdef01234567");

      expect((yield* verifyPassword(other, password, stored)).ok).toBeFalsy();
    })
  );

  it.effect(
    "records PBKDF2-SHA-256, 100,000 iterations, a 16-byte salt and a 32-byte hash",
    () =>
      Effect.gen(function* () {
        const stored = yield* hashPassword(pepper, password);

        const [algorithm, iterations, salt, hash] = stored.split("$");

        expect([algorithm, iterations]).toStrictEqual([
          "pbkdf2-sha256",
          "100000",
        ]);
        // base64url without padding: 16 bytes → 22 characters, 32 → 43.
        expect([salt?.length, hash?.length]).toStrictEqual([22, 43]);
        expect(stored).not.toContain("correct horse");
      })
  );

  it.effect("salts each hash afresh", () =>
    Effect.gen(function* () {
      const one = yield* hashPassword(pepper, password);

      const two = yield* hashPassword(pepper, password);

      expect(one).not.toBe(two);
    })
  );

  it.effect(
    "made with fewer iterations than today's, still verifies and asks to be rehashed",
    () =>
      Effect.gen(function* () {
        const old = yield* hashPasswordWith(1000)(pepper, password);

        expect(old.split("$")[1]).toBe("1000");
        expect(yield* verifyPassword(pepper, password, old)).toStrictEqual({
          needsRehash: true,
          ok: true,
        });
      })
  );

  it("is refused when it is not one this platform writes", () => {
    expect(
      [
        "pbkdf2-sha256$100000$c2FsdA$aGFzaA",
        "bcrypt$10$salt$hash",
        "pbkdf2-sha256$0$c2FsdA$aGFzaA",
        "pbkdf2-sha256$100000$c2FsdA",
      ].map((stored) => Option.isSome(PasswordHash.makeOption(stored)))
    ).toStrictEqual([true, false, false, false]);
  });
});

const cookieKey = Redacted.make(cookieKeyText);

const pending: PendingSignIn = {
  csrf: "csrf-0123456789",
  request: {
    clientId: "https://platform.test/oauth/cli",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    redirectUri: "http://127.0.0.1:43123/callback",
    resource: "https://platform.test",
    responseType: "code",
    scope: [],
    state: "state-1",
  },
};

const tampered = (sealed: string) =>
  `${sealed.startsWith("A") ? "B" : "A"}${sealed.slice(1)}`;

describe("a sign-in in progress, sealed into the form", () => {
  it.effect("opens to what was sealed", () =>
    Effect.gen(function* () {
      const sealed = yield* sealState(cookieKey, pending);

      expect(yield* openState(cookieKey, sealed)).toStrictEqual(pending);
    })
  );

  it.effect("is refused when sealed with another key, or changed", () =>
    Effect.gen(function* () {
      const sealed = yield* sealState(cookieKey, pending);

      const otherKey = Redacted.make("another-key-0123456789abcdef01234567");

      const failures = yield* Effect.forEach(
        [
          openState(otherKey, sealed),
          openState(cookieKey, tampered(sealed)),
          openState(cookieKey, "not-a-seal"),
        ],
        Effect.flip
      );

      expect(
        failures.map((failure) => failure instanceof SignInFailed)
      ).toStrictEqual([true, true, true]);
    })
  );

  it.effect("is refused once ten minutes have passed", () =>
    Effect.gen(function* () {
      const sealed = yield* sealState(cookieKey, pending);

      yield* TestClock.adjust("9 minutes");

      expect(yield* openState(cookieKey, sealed)).toStrictEqual(pending);

      yield* TestClock.adjust("2 minutes");

      expect(yield* Effect.flip(openState(cookieKey, sealed))).toBeInstanceOf(
        SignInFailed
      );
    })
  );
});

describe("the CLI's OAuth client", () => {
  it("is public, signs in with PKCE only, and comes back to a loopback port", () => {
    expect(cliClientMetadata("https://platform.test")).toStrictEqual({
      client_id: "https://platform.test/oauth/cli",
      client_name: `${Brand.name} CLI`,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://127.0.0.1/callback", "http://[::1]/callback"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });
});

const issued = (
  props: Readonly<Record<string, string>>,
  expiresAt: number
) => ({
  unwrapToken: (token: string) =>
    Promise.resolve(
      token === "alice:grant:secret"
        ? {
            audience: "https://platform.test",
            createdAt: 0,
            expiresAt,
            grant: { clientId: "cli", props, scope: [] },
            grantId: "grant",
            id: "id",
            scope: [],
            userId: "alice",
          }
        : null
    ),
});

describe("OAuth sessions", () => {
  it.effect("know a token the provider issued as the handle in its props", () =>
    Effect.gen(function* () {
      const sessions = OAuthSessions(issued({ handle: "alice" }, 3600));

      expect(yield* sessions.verify("alice:grant:secret")).toStrictEqual(
        Option.some(Person.make({ handle: Handle.make("alice") }))
      );
    })
  );

  it.effect("know nobody by a token the provider does not know", () =>
    Effect.gen(function* () {
      const sessions = OAuthSessions(issued({ handle: "alice" }, 3600));

      expect(yield* sessions.verify("alice:grant:other")).toStrictEqual(
        Option.none()
      );
    })
  );

  it.effect("know nobody by a token past its expiry", () =>
    Effect.gen(function* () {
      const sessions = OAuthSessions(issued({ handle: "alice" }, 3600));

      yield* TestClock.adjust("1 hour");

      expect(yield* sessions.verify("alice:grant:secret")).toStrictEqual(
        Option.none()
      );
    })
  );

  it.effect("know nobody by a token whose props name no handle", () =>
    Effect.gen(function* () {
      const sessions = OAuthSessions(issued({ userId: "alice" }, 3600));

      expect(yield* sessions.verify("alice:grant:secret")).toStrictEqual(
        Option.none()
      );
    })
  );
});

describe("sign-in attempts in memory", () => {
  it.effect(
    "admit five a minute under one key, then refuse until the minute is up",
    () =>
      Effect.gen(function* () {
        const attempts = yield* SignInAttempts;

        const admitted = yield* Effect.forEach([1, 2, 3, 4, 5, 6], () =>
          attempts.admit("handle:alice")
        );

        expect(admitted).toStrictEqual([true, true, true, true, true, false]);
        expect(yield* attempts.admit("handle:bob")).toBeTruthy();

        yield* TestClock.adjust("1 minute");

        expect(yield* attempts.admit("handle:alice")).toBeTruthy();
      }).pipe(Effect.provide(SignInAttemptsMemory.layer))
  );
});

const read = (response: Response) =>
  Effect.promise(() => response.text()).pipe(
    Effect.map((html) => ({ html, response }))
  );

interface Page {
  readonly html: string;
  readonly response: Response;
}

const openSignIn = (world: World, state = "state-1") =>
  world.fetch(new Request(authorizeUrl(state))).pipe(Effect.flatMap(read));

const formIn = (page: Page, cookie?: string) =>
  Effect.fromOption(formOf(page.response, page.html, cookie)).pipe(
    Effect.orDie
  );

// A valid address for any handle a test tries, valid or not.
const emailOf = (handle: string) =>
  `${handle.toLowerCase().replaceAll(/[^a-z0-9]/gu, "-")}@mail.example`;

// The code in the newest mail to `to`; a mail with no code reads as none.
const codeMailedTo = (world: World, to: string) =>
  Effect.map(world.mails, (mails) =>
    Option.fromNullishOr(
      mails
        .findLast((mail) => mail.to === to)
        ?.subject.match(/^(?<code>\d{6}) /u)?.groups?.code
    )
  );

interface Started {
  readonly cookie: string;
  readonly page: Page;
}

const startSignUp = (
  world: World,
  fields: {
    readonly displayName?: string;
    readonly email: string;
    readonly handle: string;
    readonly password: string;
  }
) =>
  Effect.gen(function* () {
    const signInForm = yield* formIn(yield* openSignIn(world));

    const page = yield* world
      .fetch(
        new Request(
          new URL(
            `/signup?request=${encodeURIComponent(signInForm.request)}`,
            origin
          )
        )
      )
      .pipe(Effect.flatMap(read));

    const form = yield* formIn(page, signInForm.cookie);

    const started = yield* world
      .fetch(
        post(
          "/signup",
          {
            csrf: form.csrf,
            displayName: fields.displayName ?? "Alice Example",
            email: fields.email,
            handle: fields.handle,
            password: fields.password,
            request: form.request,
          },
          form.cookie
        )
      )
      .pipe(Effect.flatMap(read));

    return { cookie: form.cookie, page: started } satisfies Started;
  });

const enterCode = (
  world: World,
  started: Started,
  path: string,
  code: string,
  extra: Readonly<Record<string, string>> = {}
) =>
  Effect.gen(function* () {
    const form = yield* formIn(started.page, started.cookie);

    return yield* world.fetch(
      post(
        path,
        { code, csrf: form.csrf, request: form.request, ...extra },
        form.cookie
      )
    );
  });

// The whole sign-up: the form, then the code mailed to the address. A form
// the platform refuses comes back as it is.
const signUp = (
  world: World,
  handle: string,
  secret: string,
  email = emailOf(handle)
) =>
  Effect.gen(function* () {
    const started = yield* startSignUp(world, {
      email,
      handle,
      password: secret,
    });

    // Read already, so handed back afresh.
    if (started.page.response.status !== 200) {
      return new Response(started.page.html, started.page.response);
    }

    const code = yield* Effect.fromOption(
      yield* codeMailedTo(world, email)
    ).pipe(Effect.orDie);

    return yield* enterCode(world, started, ACCOUNT_PATHS.signUpVerify, code);
  });

const signIn = (
  world: World,
  login: string,
  secret: string,
  address?: string
) =>
  Effect.gen(function* () {
    const form = yield* formIn(yield* openSignIn(world));

    return yield* world.fetch(
      post(
        "/authorize",
        { csrf: form.csrf, login, password: secret, request: form.request },
        form.cookie,
        address
      )
    );
  });

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
});

const codeIn = (response: Response) =>
  Effect.fromOption(codeOf(response)).pipe(Effect.orDie);

const accessTokenFor = (world: World, handle: string, secret: string) =>
  Effect.gen(function* () {
    const code = yield* signIn(world, handle, secret).pipe(
      Effect.flatMap(codeIn)
    );

    const response = yield* world.fetch(tokenRequest(code));

    return yield* Effect.promise(() => response.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(TokenResponse)),
      Effect.orDie
    );
  });

const alicePassword = "correct horse battery";

// The page loads nothing, cannot be framed, and posts its forms only here and to where the code goes back.
const lockedDown = (formAction: readonly string[]) => ({
  "default-src": ["'none'"],
  "form-action": ["'self'", ...formAction],
  "frame-ancestors": ["'none'"],
  "style-src": ["'unsafe-inline'"],
});

describe("the platform as its own OAuth authorization server", () => {
  it.live("publishes where to authorize and where to get a token", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const response = yield* world.fetch(
        new Request(new URL("/.well-known/oauth-authorization-server", origin))
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        authorization_endpoint: `${origin}/authorize`,
        client_id_metadata_document_supported: true,
        code_challenge_methods_supported: ["S256"],
        issuer: origin,
        token_endpoint: `${origin}/token`,
      });
    })
  );

  it.live("serves the CLI's client metadata document at its client id", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const response = yield* world.fetch(new Request(cliClient));

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toStrictEqual(
        cliClientMetadata(origin)
      );
    })
  );

  it.live("hands every other path to the rest of the platform", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const page = yield* world
        .fetch(new Request(new URL("/rpc", origin)))
        .pipe(Effect.flatMap(read));

      expect([page.response.status, page.html]).toStrictEqual([
        418,
        "platform: /rpc",
      ]);
    })
  );

  it.live(
    "shows the CLI a small sign-in page that loads nothing and cannot be framed",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const page = yield* openSignIn(world);

        expect([
          page.response.status,
          page.response.headers.get("content-type"),
          cspOf(page.response),
          page.response.headers.get("x-frame-options"),
        ]).toStrictEqual([
          200,
          "text/html; charset=utf-8",
          lockedDown([`http://127.0.0.1:${port}`]),
          "DENY",
        ]);
        expect(page.html).toContain(
          "This finishes signing in the CLI on this computer."
        );
        expect(page.html).not.toContain("What it can do");
        expect(page.html).not.toMatch(/<script|<link|<img|src=|url\(|@import/u);
        expect(Option.isSome(formOf(page.response, page.html))).toBeTruthy();
      })
  );

  it.live(
    "asks a client from another address for consent, though it names itself as the platform's CLI",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();
        const url = authorizeUrl();

        // The same metadata document, served at another origin: its name is ours, its id is not.
        url.searchParams.set("client_id", "https://other.test/oauth/cli");

        const page = yield* world
          .fetch(new Request(url))
          .pipe(Effect.flatMap(read));

        expect({
          asks: new RegExp(
            `<strong>${Brand.name} CLI</strong>[^<]* wants to act as you\\.`,
            "u"
          ).test(page.html),
          lists: page.html.includes("<summary>What it can do</summary>"),
          ours: page.html.includes("This finishes signing in the CLI"),
          status: page.response.status,
          warns: page.html.includes("Warning</strong>"),
        }).toStrictEqual({
          asks: true,
          lists: true,
          ours: false,
          status: 200,
          warns: true,
        });
      })
  );

  it.live(
    "lets the code go back to an IPv6 loopback, which no CSP host can name",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const page = yield* world
          .fetch(
            new Request(
              authorizeUrl("state-1", `http://[::1]:${port}/callback`)
            )
          )
          .pipe(Effect.flatMap(read));

        expect([page.response.status, cspOf(page.response)]).toStrictEqual([
          200,
          lockedDown(["http:"]),
        ]);
      })
  );
});

const sendToWorker = (path: string) =>
  Effect.promise(() =>
    Promise.resolve(
      worker.fetch(
        new Request(new URL(path, origin)),
        fakeEnv(),
        untouchable<ExecutionContext>("ExecutionContext")
      )
    )
  );

describe("the Worker's default export", () => {
  it.live(
    "answers OAuth metadata itself and hands everything else to the platform, touching no binding",
    () =>
      Effect.gen(function* () {
        const metadata = yield* sendToWorker(
          "/.well-known/oauth-authorization-server"
        );

        const health = yield* sendToWorker("/health");

        expect([metadata.status, health.status]).toStrictEqual([200, 200]);
        expect([
          yield* Effect.promise(() => metadata.json()),
          yield* Effect.promise(() => health.json()),
        ]).toMatchObject([
          { issuer: origin, token_endpoint: `${origin}/token` },
          { ok: true, stage: "local" },
        ]);
      })
  );
});

describe("signing up", () => {
  it.live(
    "creates the account and signs it in, back to the CLI with a code",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const response = yield* signUp(world, "alice", alicePassword);

        expect(response.status).toBe(302);
        expect(Option.isSome(codeOf(response))).toBeTruthy();
        expect(
          new URL(response.headers.get("location") ?? "").searchParams.get(
            "state"
          )
        ).toBe("state-1");
        expect(yield* world.accounts.find(Handle.make("alice"))).toMatchObject(
          Option.some({
            displayName: "Alice Example",
            email: emailOf("alice"),
            handle: "alice",
          })
        );
      })
  );

  it.live("says a handle is taken, in any case", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      yield* signUp(world, "alice", alicePassword);

      const page = yield* signUp(world, "ALICE", "another long password").pipe(
        Effect.flatMap(read)
      );

      expect(page.response.status).toBe(409);
      expect(page.html).toContain("taken");
      expect(Option.isNone(codeOf(page.response))).toBeTruthy();
    })
  );

  it.live(
    "says the operator's handle and a named session's are taken, in any case",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const pages = yield* Effect.forEach(
          [fakeEnv().OPERATOR_HANDLE.toUpperCase(), namedPerson],
          (handle) =>
            signUp(world, handle, alicePassword).pipe(Effect.flatMap(read))
        );

        for (const page of pages) {
          expect(page.response.status).toBe(409);
          expect(page.html).toContain("taken");
          expect(Option.isNone(codeOf(page.response))).toBeTruthy();
        }
      })
  );

  it.live.each([
    ["-alice", "letters, digits and dashes"],
    ["al ice", "letters, digits and dashes"],
    [Brand.slug, "reserved"],
    ["Admin", "reserved"],
    ["platform", "reserved"],
    ["root", "reserved"],
    ["api", "reserved"],
    ["www", "reserved"],
    ["support", "reserved"],
    ["security", "reserved"],
    ["people", "reserved"],
    ["import", "reserved"],
    ["datekit", "reserved"],
    ["Click", "reserved"],
  ])(
    "refuses the handle %s with a plain reason",
    ([handle = "", reason = ""]) =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const page = yield* signUp(world, handle, alicePassword).pipe(
          Effect.flatMap(read)
        );

        expect(page.response.status).toBe(400);
        expect(page.html).toContain(reason);
        expect(Option.isNone(codeOf(page.response))).toBeTruthy();
      })
  );

  it.live("refuses a password under 12 or over 256 characters", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const short = yield* signUp(world, "alice", "elevenchars").pipe(
        Effect.flatMap(read)
      );

      const long = yield* signUp(world, "alice", "x".repeat(257)).pipe(
        Effect.flatMap(read)
      );

      const exact = yield* signUp(world, "alice", "twelve chars");

      expect([short.response.status, long.response.status]).toStrictEqual([
        400, 400,
      ]);
      expect(short.html).toContain("12 to 256 characters");
      expect(long.html).toContain("12 to 256 characters");
      expect(exact.status).toBe(302);
    })
  );
});

describe("signing in from the CLI", () => {
  it.live(
    "trades a code and its verifier for an access token that names only the person",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "Alice", alicePassword);

        const { access_token, token_type } = yield* accessTokenFor(
          world,
          "alice",
          alicePassword
        );

        expect(token_type).toBe("bearer");

        const summary = yield* Effect.promise(() =>
          tokenReader(world.store).unwrapToken(access_token)
        );

        expect(summary?.grant.props).toStrictEqual({ handle: "Alice" });
      })
  );

  it.live(
    "says only that the handle or password is wrong, and issues no code",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const wrong = yield* signIn(world, "alice", "not the password").pipe(
          Effect.flatMap(read)
        );

        const nobody = yield* signIn(world, "bob", alicePassword).pipe(
          Effect.flatMap(read)
        );

        for (const page of [wrong, nobody]) {
          expect(page.response.status).toBe(401);
          expect(page.html).toContain(
            "The email, handle or password is wrong."
          );
          expect(Option.isNone(codeOf(page.response))).toBeTruthy();
          expect(
            Option.isSome(formOf(page.response, page.html, "cookie"))
          ).toBeTruthy();
        }
      })
  );

  it.live("refuses a code traded with the wrong verifier", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const code = yield* signUp(world, "alice", alicePassword).pipe(
        Effect.flatMap(codeIn)
      );

      const response = yield* world.fetch(
        tokenRequest(
          code,
          "a-verifier-of-the-right-length-but-not-the-right-one"
        )
      );

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        error: "invalid_grant",
      });
    })
  );

  it.live(
    "refuses a form it did not seal, or whose CSRF token does not match, and issues no code",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const form = yield* formIn(yield* openSignIn(world));

        const forged = yield* sealState(
          Redacted.make("not-the-cookie-key-0123456789abcdef"),
          yield* openState(cookieKey, form.request)
        );

        const attempts = [
          { ...form, request: forged },
          { ...form, csrf: "not-the-csrf-token" },
          { ...form, cookie: "not-the-csrf-token" },
        ];

        for (const attempt of attempts) {
          const page = yield* world
            .fetch(
              post(
                "/authorize",
                {
                  csrf: attempt.csrf,
                  login: "alice",
                  password: alicePassword,
                  request: attempt.request,
                },
                attempt.cookie
              )
            )
            .pipe(Effect.flatMap(read));

          expect(page.response.status).toBe(400);
          expect(page.html).toContain("Start signing in again");
          expect(Option.isNone(codeOf(page.response))).toBeTruthy();
        }
      })
  );

  it.live(
    "refuses the sixth attempt in a minute for one handle before checking the password",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const statuses = yield* Effect.forEach([1, 2, 3, 4, 5], (n) =>
          signIn(world, "alice", "not the password", `198.51.100.${n}`).pipe(
            Effect.map(({ status }) => status)
          )
        );

        const sixth = yield* signIn(
          world,
          "ALICE",
          alicePassword,
          "198.51.100.6"
        ).pipe(Effect.flatMap(read));

        expect(statuses).toStrictEqual([401, 401, 401, 401, 401]);
        expect(sixth.response.status).toBe(429);
        expect(sixth.html).toContain("Too many");
        expect(Option.isNone(codeOf(sixth.response))).toBeTruthy();
      })
  );

  it.live("refuses the sixth attempt in a minute from one address", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const statuses = yield* Effect.forEach(
        ["bob", "carol", "dave", "erin", "frank", "grace"],
        (handle) =>
          signIn(world, handle, alicePassword).pipe(
            Effect.map(({ status }) => status)
          )
      );

      expect(statuses).toStrictEqual([401, 401, 401, 401, 401, 429]);
    })
  );

  it.live(
    "replaces a password hash made with fewer iterations than today's",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const alice = Handle.make("alice");

        yield* world.accounts.create({
          email: Email.make(emailOf("alice")),
          handle: alice,
          hash: yield* hashPasswordWith(1000)(
            pepper,
            Redacted.make(alicePassword)
          ),
        });

        yield* signIn(world, "alice", alicePassword).pipe(
          Effect.flatMap(codeIn)
        );

        const stored = yield* world.accounts.find(alice);

        expect(
          Option.map(stored, ({ hash }) => hash.split("$")[1])
        ).toStrictEqual(Option.some("100000"));
      })
  );
});

describe("OAuth sessions over the provider's tokens", () => {
  it.live(
    "know the person an access token was issued to, and nobody by a changed or expired one",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const { access_token } = yield* accessTokenFor(
          world,
          "alice",
          alicePassword
        );

        const sessions = OAuthSessions(tokenReader(world.store));

        const changed = `${access_token.slice(0, -1)}${access_token.endsWith("A") ? "B" : "A"}`;

        expect(yield* sessions.verify(access_token)).toStrictEqual(
          Option.some(Person.make({ handle: Handle.make("alice") }))
        );
        expect(yield* sessions.verify(changed)).toStrictEqual(Option.none());

        yield* world.expireTokens;

        expect(yield* sessions.verify(access_token)).toStrictEqual(
          Option.none()
        );
      })
  );
});

describe("confirming a sign-up's email", () => {
  it.live(
    "mails the address a code and makes no account until the code comes back",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const started = yield* startSignUp(world, {
          email: "Alice@Mail.Example",
          handle: "alice",
          password: alicePassword,
        });

        const [mail] = yield* world.mails;

        expect(started.page.response.status).toBe(200);
        expect(started.page.html).toContain(
          "We mailed a code to Alice@Mail.Example."
        );
        expect(mail?.to).toBe("Alice@Mail.Example");
        expect(mail?.text).toContain(
          /^(?<code>\d{6}) is your /u.exec(mail?.subject ?? "")?.groups?.code
        );
        expect(yield* world.accounts.find(Handle.make("alice"))).toStrictEqual(
          Option.none()
        );
      })
  );

  it.live("refuses a wrong code, and makes no account", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const started = yield* startSignUp(world, {
        email: emailOf("alice"),
        handle: "alice",
        password: alicePassword,
      });

      const code = yield* Effect.fromOption(
        yield* codeMailedTo(world, emailOf("alice"))
      ).pipe(Effect.orDie);

      const wrong = code === "000000" ? "000001" : "000000";

      const page = yield* enterCode(
        world,
        started,
        ACCOUNT_PATHS.signUpVerify,
        wrong
      ).pipe(Effect.flatMap(read));

      expect(page.response.status).toBe(401);
      expect(page.html).toContain("That code is wrong or has expired.");
      expect(Option.isNone(codeOf(page.response))).toBeTruthy();
      expect(yield* world.accounts.find(Handle.make("alice"))).toStrictEqual(
        Option.none()
      );
    })
  );

  it.live("takes a code with spaces in it", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const started = yield* startSignUp(world, {
        email: emailOf("alice"),
        handle: "alice",
        password: alicePassword,
      });

      const code = yield* Effect.fromOption(
        yield* codeMailedTo(world, emailOf("alice"))
      ).pipe(Effect.orDie);

      const response = yield* enterCode(
        world,
        started,
        ACCOUNT_PATHS.signUpVerify,
        `${code.slice(0, 3)} ${code.slice(3)}`
      );

      expect(Option.isSome(codeOf(response))).toBeTruthy();
    })
  );

  it.live("refuses the sixth code tried for one address in a minute", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const started = yield* startSignUp(world, {
        email: emailOf("alice"),
        handle: "alice",
        password: alicePassword,
      });

      const code = yield* Effect.fromOption(
        yield* codeMailedTo(world, emailOf("alice"))
      ).pipe(Effect.orDie);

      const wrong = code === "000000" ? "000001" : "000000";

      const statuses = yield* Effect.forEach([1, 2, 3, 4, 5], () =>
        enterCode(world, started, ACCOUNT_PATHS.signUpVerify, wrong).pipe(
          Effect.map(({ status }) => status)
        )
      );

      const sixth = yield* enterCode(
        world,
        started,
        ACCOUNT_PATHS.signUpVerify,
        code
      );

      expect([...statuses, sixth.status]).toStrictEqual([
        401, 401, 401, 401, 401, 429,
      ]);
    })
  );

  it.live(
    "mails the holder of a taken address a notice in place of a code, and reads the same to the one signing up",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const started = yield* startSignUp(world, {
          email: emailOf("alice").toUpperCase(),
          handle: "mallory",
          password: "another long password",
        });

        const mails = yield* world.mails;

        expect(started.page.response.status).toBe(200);
        expect(started.page.html).toContain("We mailed a code to");
        expect(mails.at(-1)?.subject).toContain("You already have");
        expect(mails.at(-1)?.text).not.toMatch(/\d{6}/u);

        const page = yield* enterCode(
          world,
          started,
          ACCOUNT_PATHS.signUpVerify,
          "123456"
        );

        expect([
          page.status,
          Option.isNone(yield* world.accounts.find(Handle.make("mallory"))),
        ]).toStrictEqual([401, true]);
      })
  );

  it.live(
    "says so when someone took the handle while the code was in the mail",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const started = yield* startSignUp(world, {
          email: emailOf("first"),
          handle: "alice",
          password: alicePassword,
        });

        yield* signUp(world, "alice", alicePassword, emailOf("second"));

        const code = yield* Effect.fromOption(
          yield* codeMailedTo(world, emailOf("first"))
        ).pipe(Effect.orDie);

        const page = yield* enterCode(
          world,
          started,
          ACCOUNT_PATHS.signUpVerify,
          code
        ).pipe(Effect.flatMap(read));

        expect(page.response.status).toBe(409);
        expect(page.html).toContain("Someone took that handle");
        expect(page.html).toContain(`value="${emailOf("first")}"`);
      })
  );

  it.live("says the mail could not go, and makes no account", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld({ mailFails: true });

      const started = yield* startSignUp(world, {
        email: emailOf("alice"),
        handle: "alice",
        password: alicePassword,
      });

      expect(started.page.response.status).toBe(503);
      expect(started.page.html).toContain("We could not send the mail");
      expect(started.page.html).toContain(`value="${emailOf("alice")}"`);
    })
  );

  it.live.each([
    ["not an address", { email: "alice" }, "does not look like an email"],
    ["an empty display name", { displayName: " " }, "display name"],
    ["a display name of 65", { displayName: "x".repeat(65) }, "display name"],
  ] as const)("refuses %s", ([, fields, said]) =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const started = yield* startSignUp(world, {
        email: emailOf("alice"),
        handle: "alice",
        password: alicePassword,
        ...fields,
      });

      expect(started.page.response.status).toBe(400);
      expect(started.page.html).toContain(said);
      expect(yield* world.mails).toStrictEqual([]);
    })
  );
});

describe("signing in by email", () => {
  it.live("signs in by the account's email, in any case", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      yield* signUp(world, "Alice", alicePassword);

      const { access_token } = yield* accessTokenFor(
        world,
        emailOf("alice").toUpperCase(),
        alicePassword
      );

      const summary = yield* Effect.promise(() =>
        tokenReader(world.store).unwrapToken(access_token)
      );

      expect(summary?.grant.props).toStrictEqual({ handle: "Alice" });
    })
  );
});

const legacyAccount = (world: World) =>
  Effect.gen(function* () {
    yield* world.accounts.create({
      handle: Handle.make("alice"),
      hash: yield* hashPassword(pepper, Redacted.make(alicePassword)),
    });
  });

describe("an account made before sign-up asked for an email", () => {
  it.live(
    "adds and confirms one after its password, before any code goes back",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* legacyAccount(world);

        const asked = yield* signIn(world, "alice", alicePassword).pipe(
          Effect.flatMap(read)
        );

        expect(asked.response.status).toBe(200);
        expect(asked.html).toContain("Add your email");
        expect(Option.isNone(codeOf(asked.response))).toBeTruthy();

        const form = yield* formIn(asked);

        const sent = yield* world
          .fetch(
            post(
              ACCOUNT_PATHS.addEmail,
              {
                csrf: form.csrf,
                email: emailOf("alice"),
                request: form.request,
              },
              form.cookie
            )
          )
          .pipe(Effect.flatMap(read));

        const code = yield* Effect.fromOption(
          yield* codeMailedTo(world, emailOf("alice"))
        ).pipe(Effect.orDie);

        const done = yield* enterCode(
          world,
          { cookie: form.cookie, page: sent },
          ACCOUNT_PATHS.addEmailVerify,
          code
        );

        expect(Option.isSome(codeOf(done))).toBeTruthy();
        expect(yield* world.accounts.find(Handle.make("alice"))).toMatchObject(
          Option.some({ email: emailOf("alice") })
        );
      })
  );

  it.live(
    "refuses an address another account holds, once the code proves it",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "bob", alicePassword);
        yield* legacyAccount(world);

        const asked = yield* signIn(world, "alice", alicePassword).pipe(
          Effect.flatMap(read)
        );

        const form = yield* formIn(asked);

        const sent = yield* world
          .fetch(
            post(
              ACCOUNT_PATHS.addEmail,
              { csrf: form.csrf, email: emailOf("bob"), request: form.request },
              form.cookie
            )
          )
          .pipe(Effect.flatMap(read));

        const code = yield* Effect.fromOption(
          yield* codeMailedTo(world, emailOf("bob"))
        ).pipe(Effect.orDie);

        const page = yield* enterCode(
          world,
          { cookie: form.cookie, page: sent },
          ACCOUNT_PATHS.addEmailVerify,
          code
        ).pipe(Effect.flatMap(read));

        expect(page.response.status).toBe(409);
        expect(page.html).toContain("Another account already uses that email");
        expect(Option.isNone(codeOf(page.response))).toBeTruthy();
      })
  );
});

const startReset = (world: World, email: string) =>
  Effect.gen(function* () {
    const signInForm = yield* formIn(yield* openSignIn(world));

    const page = yield* world
      .fetch(
        new Request(
          new URL(
            `${ACCOUNT_PATHS.reset}?request=${encodeURIComponent(signInForm.request)}`,
            origin
          )
        )
      )
      .pipe(Effect.flatMap(read));

    const form = yield* formIn(page, signInForm.cookie);

    const sent = yield* world
      .fetch(
        post(
          ACCOUNT_PATHS.reset,
          { csrf: form.csrf, email, request: form.request },
          form.cookie
        )
      )
      .pipe(Effect.flatMap(read));

    return { cookie: form.cookie, page: sent } satisfies Started;
  });

describe("resetting a password", () => {
  it.live(
    "sets a new password by the code mailed to the account, and signs in",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const started = yield* startReset(world, emailOf("alice"));

        const code = yield* Effect.fromOption(
          yield* codeMailedTo(world, emailOf("alice"))
        ).pipe(Effect.orDie);

        const done = yield* enterCode(
          world,
          started,
          ACCOUNT_PATHS.resetVerify,
          code,
          { password: "a brand new password" }
        );

        const old = yield* signIn(world, "alice", alicePassword);

        const fresh = yield* signIn(world, "alice", "a brand new password");

        expect(Option.isSome(codeOf(done))).toBeTruthy();
        expect(old.status).toBe(401);
        expect(Option.isSome(codeOf(fresh))).toBeTruthy();
      })
  );

  it.live(
    "reads the same for an address no account has, and mails it nothing",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const before = (yield* world.mails).length;

        const known = yield* startReset(world, emailOf("alice"));

        const unknown = yield* startReset(world, emailOf("nobody"));

        const mails = yield* world.mails;

        expect([
          known.page.response.status,
          unknown.page.response.status,
        ]).toStrictEqual([200, 200]);
        expect(unknown.page.html).toContain(
          `If an account uses ${emailOf("nobody")}, we mailed it a code.`
        );
        expect(mails.slice(before).map(({ to }) => to)).toStrictEqual([
          emailOf("alice"),
        ]);

        const page = yield* enterCode(
          world,
          unknown,
          ACCOUNT_PATHS.resetVerify,
          "123456",
          { password: "a brand new password" }
        );

        expect(page.status).toBe(401);
      })
  );

  it.live("keeps the old password when the code is wrong", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      yield* signUp(world, "alice", alicePassword);

      const started = yield* startReset(world, emailOf("alice"));

      const code = yield* Effect.fromOption(
        yield* codeMailedTo(world, emailOf("alice"))
      ).pipe(Effect.orDie);

      const page = yield* enterCode(
        world,
        started,
        ACCOUNT_PATHS.resetVerify,
        code === "000000" ? "000001" : "000000",
        { password: "a brand new password" }
      );

      const old = yield* signIn(world, "alice", alicePassword);

      expect(page.status).toBe(401);
      expect(Option.isSome(codeOf(old))).toBeTruthy();
    })
  );
});

describe("a mailed code", () => {
  const email = Email.make("alice@mail.example");

  it.effect("is six digits", () =>
    Effect.gen(function* () {
      const codes = yield* Effect.forEach(
        [1, 2, 3, 4, 5, 6, 7, 8],
        () => freshCode
      );

      for (const code of codes) {
        expect(code).toMatch(/^\d{6}$/u);
      }
    })
  );

  it.effect(
    "opens only for the purpose and address it was mailed for, in any case",
    () =>
      Effect.gen(function* () {
        const tag = yield* codeTag(cookieKey, "sign-up", email, "123456");

        const opens = (
          purpose: CodePurpose,
          to: string,
          entered: string,
          key = cookieKey
        ) => codeMatches(key, purpose, Email.make(to), tag, entered);

        expect([
          yield* opens("sign-up", "alice@mail.example", "123456"),
          yield* opens("sign-up", "ALICE@mail.example", "123 456"),
          yield* opens("reset", "alice@mail.example", "123456"),
          yield* opens("add-email", "alice@mail.example", "123456"),
          yield* opens("sign-up", "bob@mail.example", "123456"),
          yield* opens("sign-up", "alice@mail.example", "123457"),
          yield* opens("sign-up", "alice@mail.example", "12345"),
          yield* opens(
            "sign-up",
            "alice@mail.example",
            "123456",
            Redacted.make("not-the-cookie-key-0123456789abcdef")
          ),
        ]).toStrictEqual([
          true,
          true,
          false,
          false,
          false,
          false,
          false,
          false,
        ]);
      })
  );

  it.effect("never opens a dead tag", () =>
    Effect.gen(function* () {
      const tag = yield* deadTag;

      expect(
        yield* codeMatches(cookieKey, "reset", email, tag, "123456")
      ).toBeFalsy();
    })
  );
});

const SESSION = "__Host-platform-session";

const webHome = fakeEnv().PUBLIC_WEB_URL;

const sessionLine = (response: Response) =>
  Option.fromNullishOr(
    response.headers
      .getSetCookie()
      .find((line) => line.startsWith(`${SESSION}=`))
  );

const sessionIn = (response: Response) =>
  Effect.fromOption(
    sessionLine(response).pipe(
      Option.flatMap((line) =>
        Option.fromNullishOr(
          /^[^=]+=(?<value>[^;]*)/u.exec(line)?.groups?.value
        )
      ),
      Option.filter((value) => value !== "")
    )
  ).pipe(Effect.orDie);

// A line that ends the session: an empty value, kept for no time at all.
const endsSession = (response: Response) =>
  Option.exists(
    sessionLine(response),
    (line) =>
      line.startsWith(`${SESSION}=;`) &&
      line.toLowerCase().includes("max-age=0")
  );

const withCookies = (
  request: Request,
  cookies: Readonly<Record<string, string>>
) => {
  const headers = new Headers(request.headers);

  headers.set(
    "cookie",
    Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ")
  );

  return new Request(request, { headers });
};

const openSignedIn = (world: World, session: string, url = authorizeUrl()) =>
  world
    .fetch(withCookies(new Request(url), { [SESSION]: session }))
    .pipe(Effect.flatMap(read));

const continueFrom = (
  world: World,
  page: Page,
  session: string,
  csrf?: string
) =>
  Effect.gen(function* () {
    const form = yield* formIn(page);

    return yield* world.fetch(
      withCookies(
        post(
          SESSION_PATHS.continue,
          { csrf: csrf ?? form.csrf, request: form.request },
          form.cookie
        ),
        { "__Host-sign-in": form.cookie, [SESSION]: session }
      )
    );
  });

const signedInSession = (world: World) =>
  Effect.gen(function* () {
    yield* signUp(world, "alice", alicePassword);

    return yield* signIn(world, "alice", alicePassword).pipe(
      Effect.flatMap(sessionIn)
    );
  });

// A session sealed as the platform would, for an account a test names.
const sessionFor = (account: Account) =>
  withSession(
    cookieKey,
    account
  )(HttpServerResponse.empty()).pipe(
    Effect.map(HttpServerResponse.toWeb),
    Effect.flatMap(sessionIn)
  );

const asksToContinue = (page: Page) => ({
  continues: page.html.includes("Continue as @alice"),
  password: page.html.includes('name="password"'),
  status: page.response.status,
});

describe("the platform's own session", () => {
  it.live(
    "keeps the person signed in here for thirty days after a grant, out of reach of scripts and other sites' posts",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* signUp(world, "alice", alicePassword);

        const signedIn = yield* signIn(world, "alice", alicePassword);

        const attributes = Option.map(sessionLine(signedIn), (line) =>
          line
            .split(";")
            .slice(1)
            .map((part) => part.trim().toLowerCase())
            .toSorted()
        );

        expect(Option.isSome(codeOf(signedIn))).toBeTruthy();
        expect(attributes).toStrictEqual(
          Option.some([
            "httponly",
            "max-age=2592000",
            "path=/",
            "samesite=lax",
            "secure",
          ])
        );
      })
  );

  it.live(
    "asks only to continue on the next sign-in, and gives the code to the same person",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* signedInSession(world);

        const page = yield* openSignedIn(
          world,
          session,
          authorizeUrl("state-2")
        );

        const code = yield* continueFrom(world, page, session).pipe(
          Effect.flatMap(codeIn)
        );

        const response = yield* world.fetch(tokenRequest(code));

        const { access_token } = yield* Effect.promise(() =>
          response.json()
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(TokenResponse)),
          Effect.orDie
        );

        expect(asksToContinue(page)).toStrictEqual({
          continues: true,
          password: false,
          status: 200,
        });
        expect(
          yield* OAuthSessions(tokenReader(world.store)).verify(access_token)
        ).toStrictEqual(
          Option.some(Person.make({ handle: Handle.make("alice") }))
        );
      })
  );

  it.live(
    "shows a client that is not ours who asks and what it may do, then the button",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* signedInSession(world);

        const url = authorizeUrl();

        url.searchParams.set("client_id", "https://other.test/oauth/cli");

        const page = yield* openSignedIn(world, session, url);

        expect({
          ...asksToContinue(page),
          asks: page.html.includes("wants to act as you."),
          host: page.html.includes("Access goes to <strong>127.0.0.1"),
          lists: page.html.includes("<summary>What it can do</summary>"),
        }).toStrictEqual({
          asks: true,
          continues: true,
          host: true,
          lists: true,
          password: false,
          status: 200,
        });
      })
  );

  it.live(
    "reads a changed session as none, the same page as no session, and drops it",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* signedInSession(world);

        const page = yield* openSignedIn(world, tampered(session));

        expect({
          ...asksToContinue(page),
          dropped: endsSession(page.response),
        }).toStrictEqual({
          continues: false,
          dropped: true,
          password: true,
          status: 200,
        });
      })
  );

  it.live(
    "ends with a reset of the password, wherever it was kept, and a new one starts",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* signedInSession(world);

        const started = yield* startReset(world, emailOf("alice"));

        const code = yield* Effect.fromOption(
          yield* codeMailedTo(world, emailOf("alice"))
        ).pipe(Effect.orDie);

        const reset = yield* enterCode(
          world,
          started,
          ACCOUNT_PATHS.resetVerify,
          code,
          { password: "a brand new password" }
        );

        const old = yield* openSignedIn(world, session);

        const fresh = yield* openSignedIn(world, yield* sessionIn(reset));

        expect([
          asksToContinue(old),
          endsSession(old.response),
          asksToContinue(fresh).continues,
        ]).toStrictEqual([
          { continues: false, password: true, status: 200 },
          true,
          true,
        ]);
      })
  );

  it.live(
    "names nobody for an account that is not there, though its session is genuine",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* sessionFor({
          email: Email.make("ghost@mail.example"),
          handle: Handle.make("ghost"),
          hash: yield* hashPassword(pepper, password),
        });

        const page = yield* openSignedIn(world, session);

        expect({
          ...asksToContinue(page),
          dropped: endsSession(page.response),
        }).toStrictEqual({
          continues: false,
          dropped: true,
          password: true,
          status: 200,
        });
      })
  );

  it.live("refuses a continue with another form's CSRF token, or none", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld();

      const session = yield* signedInSession(world);

      const page = yield* openSignedIn(world, session);

      const wrong = yield* continueFrom(world, page, session, "another-token");

      const form = yield* formIn(page);

      const without = yield* world.fetch(
        withCookies(
          post(
            SESSION_PATHS.continue,
            { csrf: form.csrf, request: form.request },
            form.cookie
          ),
          { [SESSION]: session }
        )
      );

      expect([
        wrong.status,
        Option.isNone(codeOf(wrong)),
        without.status,
        Option.isNone(codeOf(without)),
      ]).toStrictEqual([400, true, 400, true]);
    })
  );

  it.live(
    "asks to sign in again when the session ended between the page and the click",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* signedInSession(world);

        const page = yield* openSignedIn(world, session);

        const clicked = yield* continueFrom(
          world,
          page,
          tampered(session)
        ).pipe(Effect.flatMap(read));

        expect({
          ...asksToContinue(clicked),
          code: Option.isSome(codeOf(clicked.response)),
          dropped: endsSession(clicked.response),
          says: clicked.html.includes("You were signed out here."),
        }).toStrictEqual({
          code: false,
          continues: false,
          dropped: true,
          password: true,
          says: true,
          status: 200,
        });
      })
  );

  it.live(
    "lets the person use another account: the session is dropped and the same request asks to sign in",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* signedInSession(world);

        const page = yield* openSignedIn(
          world,
          session,
          authorizeUrl("state-9")
        );

        const form = yield* formIn(page);

        const switched = yield* world
          .fetch(
            withCookies(
              new Request(
                new URL(
                  `${SESSION_PATHS.switch}?request=${encodeURIComponent(form.request)}`,
                  origin
                )
              ),
              { [SESSION]: session }
            )
          )
          .pipe(Effect.flatMap(read));

        const again = yield* formIn(switched);

        const signedIn = yield* world.fetch(
          post(
            "/authorize",
            {
              csrf: again.csrf,
              login: "alice",
              password: alicePassword,
              request: again.request,
            },
            again.cookie
          )
        );

        expect({
          ...asksToContinue(switched),
          dropped: endsSession(switched.response),
          state: Option.map(
            Option.fromNullishOr(signedIn.headers.get("location")),
            (location) => new URL(location).searchParams.get("state")
          ),
        }).toStrictEqual({
          continues: false,
          dropped: true,
          password: true,
          state: Option.some("state-9"),
          status: 200,
        });
      })
  );

  it.live(
    "signs out to the web's home alone, whatever address the request names",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        const session = yield* signedInSession(world);

        const answers = yield* Effect.forEach(["GET", "POST"], (method) =>
          world.fetch(
            withCookies(
              new Request(
                new URL(
                  `${SESSION_PATHS.signOut}?return=https://elsewhere.example/&redirect_uri=https://elsewhere.example/`,
                  origin
                ),
                { method, redirect: "manual" }
              ),
              { [SESSION]: session }
            )
          )
        );

        expect(
          answers.map((response) => [
            response.status,
            response.headers.get("location"),
            endsSession(response),
          ])
        ).toStrictEqual([
          [302, webHome, true],
          [302, webHome, true],
        ]);
      })
  );

  it.live(
    "asks an account with no email for one before it continues, and gives no code",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld();

        yield* legacyAccount(world);

        const account = yield* Effect.fromOption(
          yield* world.accounts.find(Handle.make("alice"))
        ).pipe(Effect.orDie);

        const session = yield* sessionFor(account);

        const page = yield* openSignedIn(world, session);

        const clicked = yield* continueFrom(world, page, session).pipe(
          Effect.flatMap(read)
        );

        expect([
          asksToContinue(page).continues,
          clicked.html.includes("Add your email"),
          Option.isNone(codeOf(clicked.response)),
        ]).toStrictEqual([true, true, true]);
      })
  );
});

describe("a session's lifetime", () => {
  it.effect("names its account for thirty days, and nobody after", () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts;

      const account = {
        email: Email.make("alice@mail.example"),
        handle: Handle.make("alice"),
        hash: yield* hashPasswordWith(1000)(pepper, password),
      };

      yield* accounts.create(account);

      const session = yield* sessionFor(account);

      const request = HttpServerRequest.fromWeb(
        new Request(origin, { headers: { cookie: `${SESSION}=${session}` } })
      );

      const opened = () =>
        Effect.map(sessionAccount(cookieKey, request), Option.isSome);

      yield* TestClock.adjust("29 days");

      const before = yield* opened();

      yield* TestClock.adjust("1 day");

      expect([before, yield* opened()]).toStrictEqual([true, false]);
    }).pipe(Effect.provide(AccountsMemory.layer))
  );
});
