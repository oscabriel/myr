import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { untouchable } from "@repo/testkit/untouchable";
import { Effect, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { OAuthSessions } from "../src/adapters/sessions-oauth.ts";
import { SignInAttempts } from "../src/auth/attempts.ts";
import { SignInAttemptsMemory } from "../src/auth/attempts/memory.ts";
import { cliClientMetadata } from "../src/auth/cli-client.ts";
import {
  hashPassword,
  hashPasswordWith,
  PasswordHash,
  verifyPassword,
} from "../src/auth/password.ts";
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

const signUp = (world: World, handle: string, secret: string) =>
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

    return yield* world.fetch(
      post(
        "/signup",
        { csrf: form.csrf, handle, password: secret, request: form.request },
        form.cookie
      )
    );
  });

const signIn = (
  world: World,
  handle: string,
  secret: string,
  address?: string
) =>
  Effect.gen(function* () {
    const form = yield* formIn(yield* openSignIn(world));

    return yield* world.fetch(
      post(
        "/authorize",
        { csrf: form.csrf, handle, password: secret, request: form.request },
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

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'";

describe("the platform as its own OAuth authorization server", () => {
  it.live("publishes where to authorize and where to get a token", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld;

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
      const world = yield* signInWorld;

      const response = yield* world.fetch(new Request(cliClient));

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toStrictEqual(
        cliClientMetadata(origin)
      );
    })
  );

  it.live("hands every other path to the rest of the platform", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld;

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
        const world = yield* signInWorld;

        const page = yield* openSignIn(world);

        expect([
          page.response.status,
          page.response.headers.get("content-type"),
          page.response.headers.get("content-security-policy"),
          page.response.headers.get("x-frame-options"),
        ]).toStrictEqual([
          200,
          "text/html; charset=utf-8",
          `${CSP} http://127.0.0.1:${port}`,
          "DENY",
        ]);
        expect(page.html).toContain(`${Brand.name} CLI`);
        expect(page.html).not.toMatch(/<script|<link|<img|src=|url\(|@import/u);
        expect(Option.isSome(formOf(page.response, page.html))).toBeTruthy();
      })
  );

  it.live(
    "lets the code go back to an IPv6 loopback, which no CSP host can name",
    () =>
      Effect.gen(function* () {
        const world = yield* signInWorld;

        const page = yield* world
          .fetch(
            new Request(
              authorizeUrl("state-1", `http://[::1]:${port}/callback`)
            )
          )
          .pipe(Effect.flatMap(read));

        expect([
          page.response.status,
          page.response.headers.get("content-security-policy"),
        ]).toStrictEqual([200, `${CSP} http:`]);
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
        const world = yield* signInWorld;

        const response = yield* signUp(world, "alice", alicePassword);

        expect(response.status).toBe(302);
        expect(Option.isSome(codeOf(response))).toBeTruthy();
        expect(
          new URL(response.headers.get("location") ?? "").searchParams.get(
            "state"
          )
        ).toBe("state-1");
        expect(
          Option.isSome(yield* world.accounts.find(Handle.make("alice")))
        ).toBeTruthy();
      })
  );

  it.live("says a handle is taken, in any case", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld;

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
        const world = yield* signInWorld;

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
        const world = yield* signInWorld;

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
      const world = yield* signInWorld;

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
        const world = yield* signInWorld;

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
        const world = yield* signInWorld;

        yield* signUp(world, "alice", alicePassword);

        const wrong = yield* signIn(world, "alice", "not the password").pipe(
          Effect.flatMap(read)
        );

        const nobody = yield* signIn(world, "bob", alicePassword).pipe(
          Effect.flatMap(read)
        );

        for (const page of [wrong, nobody]) {
          expect(page.response.status).toBe(401);
          expect(page.html).toContain("The handle or password is wrong.");
          expect(Option.isNone(codeOf(page.response))).toBeTruthy();
          expect(
            Option.isSome(formOf(page.response, page.html, "cookie"))
          ).toBeTruthy();
        }
      })
  );

  it.live("refuses a code traded with the wrong verifier", () =>
    Effect.gen(function* () {
      const world = yield* signInWorld;

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
        const world = yield* signInWorld;

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
                  handle: "alice",
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
        const world = yield* signInWorld;

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
      const world = yield* signInWorld;

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
        const world = yield* signInWorld;

        const alice = Handle.make("alice");

        yield* world.accounts.create(
          alice,
          yield* hashPasswordWith(1000)(pepper, Redacted.make(alicePassword))
        );

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
        const world = yield* signInWorld;

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
