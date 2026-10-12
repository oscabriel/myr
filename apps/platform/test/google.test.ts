import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { Handle } from "@repo/protocol/ids";
import { untouchable } from "@repo/testkit/untouchable";
import {
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { IdentitiesD1 } from "../src/adapters/identities-d1.ts";
import { Email } from "../src/auth/accounts.ts";
import {
  GOOGLE_DISCOVERY,
  googleAuthorizeUrl,
  GoogleKeysPerIsolate,
  googlePerson,
} from "../src/auth/google.ts";
import type { GoogleKeys } from "../src/auth/google.ts";
import { Identities, IdentityTaken } from "../src/auth/identities.ts";
import { IdentitiesMemory } from "../src/auth/identities/memory.ts";
import { hashPassword } from "../src/auth/password.ts";
import { tokenReader } from "../src/auth/provider.ts";
import { SignInFailed } from "../src/auth/state.ts";
import { decodeEnv, InvalidEnv } from "../src/platform.ts";
import worker from "../src/worker.ts";
import { fakeEnv, passwordPepper } from "./fake-env.ts";
import {
  clientId,
  clientSecret,
  fakeGoogle,
  googleEmailOf,
  googleEnv,
  googleNameOf,
  googleWorld,
  jwksUri,
} from "./google.fixtures.ts";
import type {
  Consent,
  FakeGoogle,
  GoogleWorld,
  Site,
} from "./google.fixtures.ts";
import {
  authorizeUrl,
  codeOf,
  formOf,
  origin,
  tokenRequest,
} from "./oauth.fixtures.ts";

const alicePassword = "correct horse battery";

describe("the Worker's env, for Google sign-in", () => {
  it.effect(
    "decodes Google's client id and its secret, redacted, as a pair",
    () =>
      Effect.gen(function* () {
        const config = yield* decodeEnv(googleEnv());

        expect([
          config.GOOGLE_CLIENT_ID,
          Option.map(
            Option.fromUndefinedOr(config.GOOGLE_CLIENT_SECRET),
            Redacted.value
          ),
        ]).toStrictEqual([clientId, Option.some(clientSecret)]);
      })
  );

  it.effect("leaves Google sign-in off when neither is set", () =>
    Effect.gen(function* () {
      const config = yield* decodeEnv(googleEnv([]));

      expect([
        config.GOOGLE_CLIENT_ID,
        config.GOOGLE_CLIENT_SECRET,
      ]).toStrictEqual([undefined, undefined]);
    })
  );

  it.effect(
    "is invalid with one of the pair and not the other, naming the missing one",
    () =>
      Effect.gen(function* () {
        const failures = yield* Effect.forEach(
          [["GOOGLE_CLIENT_ID"], ["GOOGLE_CLIENT_SECRET"]] as const,
          (keys) => Effect.flip(decodeEnv(googleEnv(keys)))
        );

        expect(failures).toStrictEqual([
          new InvalidEnv({ keys: ["GOOGLE_CLIENT_SECRET"] }),
          new InvalidEnv({ keys: ["GOOGLE_CLIENT_ID"] }),
        ]);
      })
  );
});

const alice = Handle.make("alice");

const handleOf = (subject: string) =>
  Identities.use((identities) => identities.handleOf("google", subject));

const describeIdentities = (
  adapter: string,
  layer: Layer.Layer<Identities>
) => {
  describe(`Identities over ${adapter}`, () => {
    it.effect("knows nobody by a subject no one linked", () =>
      Effect.gen(function* () {
        expect(yield* handleOf("1042")).toStrictEqual(Option.none());
      }).pipe(Effect.provide(layer))
    );

    it.effect(
      "names the handle a subject was linked to, by its key (lowercased)",
      () =>
        Effect.gen(function* () {
          const identities = yield* Identities;

          yield* identities.link("google", "1042", Handle.make("Alice"));

          expect(yield* handleOf("1042")).toStrictEqual(Option.some(alice));
          expect(yield* handleOf("1043")).toStrictEqual(Option.none());
        }).pipe(Effect.provide(layer))
    );

    it.effect(
      "links a subject to its own handle again, in any case, without change",
      () =>
        Effect.gen(function* () {
          const identities = yield* Identities;

          yield* identities.link("google", "1042", alice);
          yield* identities.link("google", "1042", Handle.make("ALICE"));

          expect(yield* handleOf("1042")).toStrictEqual(Option.some(alice));
        }).pipe(Effect.provide(layer))
    );

    it.effect(
      "refuses to link a subject to a second handle, and keeps the first",
      () =>
        Effect.gen(function* () {
          const identities = yield* Identities;

          yield* identities.link("google", "1042", alice);

          const taken = yield* Effect.flip(
            identities.link("google", "1042", Handle.make("bob"))
          );

          expect(taken).toStrictEqual(
            new IdentityTaken({ provider: "google", subject: "1042" })
          );
          expect(yield* handleOf("1042")).toStrictEqual(Option.some(alice));
        }).pipe(Effect.provide(layer))
    );

    it.effect("lets one handle hold two subjects", () =>
      Effect.gen(function* () {
        const identities = yield* Identities;

        yield* identities.link("google", "1042", alice);
        yield* identities.link("google", "2084", alice);

        expect([
          yield* handleOf("1042"),
          yield* handleOf("2084"),
        ]).toStrictEqual([Option.some(alice), Option.some(alice)]);
      }).pipe(Effect.provide(layer))
    );

    it.effect(
      "lets exactly one of two racing links to different handles have a subject",
      () =>
        Effect.gen(function* () {
          const identities = yield* Identities;

          const exits = yield* Effect.all(
            [
              Effect.exit(identities.link("google", "1042", alice)),
              Effect.exit(
                identities.link("google", "1042", Handle.make("bob"))
              ),
            ],
            { concurrency: "unbounded" }
          );

          expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
        }).pipe(Effect.provide(layer))
    );
  });
};

describeIdentities("memory", Layer.fresh(IdentitiesMemory.layer));

const migrated = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const sql = yield* SqlClient;

    const ddl = yield* fs.readFileString(
      new URL("../migrations/0003_identities.sql", import.meta.url).pathname
    );

    yield* sql.unsafe(ddl);
  })
).pipe(Layer.orDie, Layer.provide(NodeServices.layer));

const database = migrated.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  Layer.orDie
);

describeIdentities(
  "D1 (sqlite-node)",
  IdentitiesD1.pipe(Layer.provide(database))
);

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const callbackUri = "https://platform.test/oauth/google/callback";

const nonce = "nonce-0123456789abcdef";

describe("Google's authorization request", () => {
  it("asks for a code with openid, email and profile, PKCE by S256, the state and the nonce", () => {
    const url = new URL(
      googleAuthorizeUrl({
        clientId,
        codeChallenge: challenge,
        nonce,
        redirectUri: callbackUri,
        state: "sealed-state",
      })
    );

    expect([
      `${url.origin}${url.pathname}`,
      Object.fromEntries(url.searchParams),
    ]).toStrictEqual([
      "https://accounts.google.com/o/oauth2/v2/auth",
      {
        client_id: "419-test.apps.googleusercontent.com",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        nonce: "nonce-0123456789abcdef",
        redirect_uri: "https://platform.test/oauth/google/callback",
        response_type: "code",
        scope: "openid email profile",
        state: "sealed-state",
      },
    ]);
  });
});

const authorizationRequest = new URL(
  `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    nonce,
    redirect_uri: callbackUri,
    response_type: "code",
    scope: "openid email profile",
    state: "sealed-state",
  }).toString()}`
).toString();

const personOf = (
  google: FakeGoogle,
  consent: Consent,
  kept: { readonly codeVerifier?: string; readonly nonce?: string } = {}
) =>
  Effect.gen(function* () {
    const back = yield* google.consent(authorizationRequest, consent);

    return yield* googlePerson({
      clientId,
      clientSecret: Redacted.make(clientSecret),
      code: back.searchParams.get("code") ?? "",
      codeVerifier: kept.codeVerifier ?? verifier,
      nonce: kept.nonce ?? nonce,
      redirectUri: callbackUri,
    });
  });

const subjectOf = (
  google: FakeGoogle,
  consent: Consent,
  kept: { readonly codeVerifier?: string; readonly nonce?: string } = {}
) => Effect.map(personOf(google, consent, kept), ({ subject }) => subject);

const withGoogle = <A, E>(
  body: (google: FakeGoogle) => Effect.Effect<A, E, Fetch | GoogleKeys>
) =>
  Effect.gen(function* () {
    const google = yield* fakeGoogle;

    return yield* body(google).pipe(
      Effect.provide(
        GoogleKeysPerIsolate.pipe(
          Layer.provideMerge(Layer.succeed(Fetch, google.fetch))
        )
      )
    );
  });

describe("the person Google confirms", () => {
  it.live(
    "carries the ID token's email only when Google verified it, and its name",
    () =>
      withGoogle((google) =>
        Effect.gen(function* () {
          const verified = yield* personOf(google, { sub: "1042" });

          const unverified = yield* personOf(google, {
            claims: { email_verified: false },
            sub: "1042",
          });

          const malformed = yield* personOf(google, {
            claims: { email: "not an address" },
            sub: "1042",
          });

          const bare = yield* personOf(google, {
            claims: { email: undefined, name: undefined },
            sub: "1042",
          });

          expect([
            verified,
            unverified.email,
            malformed.email,
            bare,
          ]).toStrictEqual([
            {
              email: Option.some(googleEmailOf("1042")),
              name: Option.some(googleNameOf("1042")),
              subject: "1042",
            },
            Option.none(),
            Option.none(),
            { email: Option.none(), name: Option.none(), subject: "1042" },
          ]);
        })
      )
  );

  it.live("is the ID token's subject, once its signature and claims hold", () =>
    withGoogle((google) =>
      Effect.gen(function* () {
        expect(yield* subjectOf(google, { sub: "1042" })).toBe("1042");
      })
    )
  );

  it.live("may come from either spelling of Google's issuer", () =>
    withGoogle((google) =>
      Effect.gen(function* () {
        expect(
          yield* subjectOf(google, {
            claims: { iss: "accounts.google.com" },
            sub: "1042",
          })
        ).toBe("1042");
      })
    )
  );

  it.live(
    "is nobody when the signature, issuer, audience, expiry or nonce is wrong, or the code's verifier is",
    () =>
      withGoogle((google) =>
        Effect.gen(function* () {
          const impostor = yield* google.keyPair("google-key-1");

          const refusals = yield* Effect.forEach(
            [
              subjectOf(google, { signWith: impostor, sub: "1042" }),
              subjectOf(google, {
                claims: { iss: "https://accounts.example" },
                sub: "1042",
              }),
              subjectOf(google, {
                claims: { aud: "someone-else.apps.googleusercontent.com" },
                sub: "1042",
              }),
              subjectOf(google, {
                claims: { exp: 1_700_000_000 },
                sub: "1042",
              }),
              subjectOf(google, { sub: "1042" }, { nonce: "another-nonce" }),
              subjectOf(
                google,
                { sub: "1042" },
                {
                  codeVerifier:
                    "a-verifier-of-the-right-length-but-not-the-right-one",
                }
              ),
            ],
            (attempt) => Effect.flip(attempt)
          );

          expect(
            refusals.map((refusal) => refusal instanceof SignInFailed)
          ).toStrictEqual([true, true, true, true, true, true]);
        })
      )
  );

  it.live(
    "is nobody when the token names another party, or several audiences without naming this client its party",
    () =>
      withGoogle((google) =>
        Effect.gen(function* () {
          const audiences = [clientId, "another.apps.googleusercontent.com"];

          const named = yield* subjectOf(google, {
            claims: { aud: audiences, azp: clientId },
            sub: "1042",
          });

          const refusals = yield* Effect.forEach(
            [
              subjectOf(google, {
                claims: { aud: audiences, azp: undefined },
                sub: "1042",
              }),
              subjectOf(google, {
                claims: { azp: "another.apps.googleusercontent.com" },
                sub: "1042",
              }),
            ],
            (attempt) => Effect.flip(attempt)
          );

          expect([
            named,
            ...refusals.map((refusal) => refusal instanceof SignInFailed),
          ]).toStrictEqual(["1042", true, true]);
        })
      )
  );

  it.live(
    "is checked against keys fetched once per isolate, and fetched again once for a key not kept",
    () =>
      withGoogle((google) =>
        Effect.gen(function* () {
          yield* subjectOf(google, { sub: "1042" });
          yield* subjectOf(google, { sub: "2084" });

          const once = yield* google.timesFetched(jwksUri);

          const rotated = yield* google.rotate("google-key-2");

          expect(
            yield* subjectOf(google, { signWith: rotated, sub: "1042" })
          ).toBe("1042");

          const afterRotation = yield* google.timesFetched(jwksUri);

          const unknown = yield* Effect.flip(
            subjectOf(google, { kid: "google-key-9", sub: "1042" })
          );

          yield* subjectOf(google, { signWith: rotated, sub: "2084" });

          expect([
            once,
            afterRotation,
            yield* google.timesFetched(jwksUri),
            yield* google.timesFetched(GOOGLE_DISCOVERY),
            unknown instanceof SignInFailed,
          ]).toStrictEqual([1, 2, 3, 1, true]);
        })
      )
  );
});

interface Page {
  readonly html: string;
  readonly response: Response;
}

const read = (response: Response) =>
  Effect.promise(() => response.text()).pipe(
    Effect.map((html): Page => ({ html, response }))
  );

const visit = (world: GoogleWorld, path: Request | string, from?: Site) =>
  world.browser.send(
    path instanceof Request ? path : new Request(new URL(path, origin)),
    from
  );

const openSignIn = (world: GoogleWorld) =>
  visit(world, new Request(authorizeUrl())).pipe(Effect.flatMap(read));

const googleLinkIn = (page: Page) =>
  Option.fromNullishOr(
    /<a href="(?<href>\/oauth\/google\/start\?[^"]*)"/u.exec(page.html)?.groups
      ?.href
  ).pipe(Option.map((href) => href.replaceAll("&amp;", "&")));

const continueWithGoogle = (world: GoogleWorld) =>
  Effect.gen(function* () {
    const page = yield* openSignIn(world);

    const href = yield* Effect.fromOption(googleLinkIn(page)).pipe(
      Effect.orDie
    );

    return yield* visit(world, href);
  });

const locationOf = (response: Response) =>
  Option.fromNullishOr(response.headers.get("location")).pipe(
    Option.flatMap((location) => Option.fromNullishOr(URL.parse(location)))
  );

const sendToWorker = (method: "GET" | "POST", path: string) =>
  Effect.promise(() =>
    Promise.resolve(
      worker.fetch(
        method === "POST"
          ? new Request(new URL(path, origin), {
              body: new URLSearchParams(),
              method: "POST",
            })
          : new Request(new URL(path, origin)),
        fakeEnv(),
        untouchable<ExecutionContext>("ExecutionContext")
      )
    )
  );

describe("Google sign-in, without a Google OAuth client", () => {
  it.live("offers no Google button on the sign-in page", () =>
    Effect.gen(function* () {
      const world = yield* googleWorld({ google: false });

      const page = yield* openSignIn(world);

      expect(page.response.status).toBe(200);
      expect(Option.isSome(formOf(page.response, page.html))).toBeTruthy();
      expect(page.html).not.toContain("Google");
      expect(
        page.response.headers.get("content-security-policy")
      ).not.toContain("accounts.google.com");
    })
  );

  it.live(
    "answers Google's paths with 404, in the Worker as worker.ts builds it",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld({ google: false });

        const form = yield* Effect.fromOption(
          Option.flatMap(Option.some(yield* openSignIn(world)), (page) =>
            formOf(page.response, page.html)
          )
        ).pipe(Effect.orDie);

        const started = yield* visit(
          world,
          `/oauth/google/start?request=${encodeURIComponent(form.request)}`
        );

        const statuses = yield* Effect.forEach(
          [
            ["GET", "/oauth/google/start?request=x"],
            ["GET", "/oauth/google/callback?code=x&state=y"],
            ["POST", "/oauth/google/link"],
            ["POST", "/oauth/google/handle"],
          ] as const,
          ([method, path]) =>
            Effect.map(sendToWorker(method, path), ({ status }) => status)
        );

        expect([started.status, ...statuses]).toStrictEqual([
          404, 404, 404, 404, 404,
        ]);
      })
  );
});

describe("Google sign-in, with a Google OAuth client", () => {
  it.live(
    'offers "Continue with Google" and "Sign in and link Google" on the sign-in page',
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const page = yield* openSignIn(world);

        expect(Option.isSome(googleLinkIn(page))).toBeTruthy();
        expect(page.html).toContain("Continue with Google");
        expect(page.html).toContain('formaction="/oauth/google/link"');
        expect(page.response.headers.get("content-security-policy")).toContain(
          "https://accounts.google.com"
        );
      })
  );

  it.live(
    "sends the person to Google for a code, with openid, email and profile, PKCE by S256, a sealed state and a nonce",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const response = yield* continueWithGoogle(world);

        const location = yield* Effect.fromOption(locationOf(response)).pipe(
          Effect.orDie
        );

        const query = Object.fromEntries(location.searchParams);

        expect([
          response.status,
          `${location.origin}${location.pathname}`,
          query.client_id,
          query.response_type,
          query.scope,
          query.code_challenge_method,
          query.code_challenge?.length,
          query.redirect_uri,
          (query.nonce ?? "").length >= 22,
          (query.state ?? "").length > 0,
        ]).toStrictEqual([
          302,
          "https://accounts.google.com/o/oauth2/v2/auth",
          clientId,
          "code",
          "openid email profile",
          "S256",
          43,
          `${origin}/oauth/google/callback`,
          true,
          true,
        ]);
        expect(
          Option.isSome(world.browser.cookie("__Host-google-sign-in"))
        ).toBeTruthy();
      })
  );

  it.live(
    "refuses to start from a sign-in page this browser did not open",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const elsewhere = yield* googleWorld();

        const href = yield* Effect.fromOption(
          googleLinkIn(yield* openSignIn(elsewhere))
        ).pipe(Effect.orDie);

        const page = yield* visit(world, href).pipe(Effect.flatMap(read));

        expect(page.response.status).toBe(400);
        expect(page.html).toContain("Start signing in again");
        expect(Option.isNone(locationOf(page.response))).toBeTruthy();
      })
  );
});

const formPost = (path: string, fields: Readonly<Record<string, string>>) =>
  new Request(new URL(path, origin), {
    body: new URLSearchParams(fields),
    headers: {
      "cf-connecting-ip": "198.51.100.7",
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

const formIn = (page: Page) =>
  Effect.fromOption(formOf(page.response, page.html, "kept")).pipe(
    Effect.orDie
  );

const backFromGoogle = (
  world: GoogleWorld,
  response: Response,
  consent: Consent
) =>
  Effect.gen(function* () {
    const location = yield* Effect.fromOption(locationOf(response)).pipe(
      Effect.orDie
    );

    const back = yield* world.google.consent(location.toString(), consent);

    return yield* visit(world, back.toString(), "cross-site").pipe(
      Effect.flatMap(read)
    );
  });

const chooseHandle = (
  world: GoogleWorld,
  page: Page,
  handle: string,
  displayName = "Carol Example"
) =>
  Effect.gen(function* () {
    const form = yield* formIn(page);

    return yield* visit(
      world,
      formPost("/oauth/google/handle", {
        csrf: form.csrf,
        displayName,
        handle,
        request: form.request,
      })
    );
  });

const AccessToken = Schema.fromJsonString(
  Schema.Struct({ access_token: Schema.String })
);

const propsFor = (world: GoogleWorld, response: Response) =>
  Effect.gen(function* () {
    const code = yield* Effect.fromOption(codeOf(response)).pipe(Effect.orDie);

    const answer = yield* visit(world, tokenRequest(code));

    const { access_token } = yield* Effect.promise(() => answer.text()).pipe(
      Effect.flatMap(Schema.decodeEffect(AccessToken)),
      Effect.orDie
    );

    const summary = yield* Effect.promise(() =>
      tokenReader(world.store).unwrapToken(access_token)
    );

    return summary?.grant.props;
  });

const isPickHandle = (page: Page) => page.html.includes("Set up your profile");

describe("coming back from Google", () => {
  it.live(
    "asks a first-time Google account for a handle and a name, Google's filled in, then signs it in as that handle with Google's email",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        expect([
          page.response.status,
          isPickHandle(page),
          page.html.includes(`value="${googleNameOf("1042")}"`),
        ]).toStrictEqual([200, true, true]);

        const signedIn = yield* chooseHandle(world, page, "carol");

        expect(signedIn.status).toBe(302);
        expect(yield* propsFor(world, signedIn)).toStrictEqual({
          handle: "carol",
        });
        expect(yield* world.accounts.find(Handle.make("carol"))).toMatchObject(
          Option.some({
            displayName: "Carol Example",
            email: googleEmailOf("1042"),
          })
        );
        expect(
          yield* world.identities.handleOf("google", "1042")
        ).toStrictEqual(Option.some(Handle.make("carol")));
      })
  );

  it.live(
    "signs a known Google account straight in as its handle, with Google's keys fetched once",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const first = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        yield* chooseHandle(world, first, "Carol");

        const again = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        expect(again.response.status).toBe(302);
        expect(yield* propsFor(world, again.response)).toStrictEqual({
          handle: "Carol",
        });
        expect(yield* world.google.timesFetched(jwksUri)).toBe(1);
      })
  );

  it.live(
    "signs a double-clicked handle form in as the handle both times, not as taken",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        const form = yield* formIn(page);

        const first = yield* chooseHandle(world, page, "carol");

        const second = new Request(
          formPost("/oauth/google/handle", {
            csrf: form.csrf,
            displayName: "Carol Example",
            handle: "carol",
            request: form.request,
          }),
          {
            headers: {
              "cf-connecting-ip": "198.51.100.7",
              "content-type": "application/x-www-form-urlencoded",
              cookie: `__Host-sign-in=${form.csrf}`,
            },
          }
        );

        const again = yield* visit(world, second);

        expect([first.status, again.status]).toStrictEqual([302, 302]);
        expect(yield* propsFor(world, again)).toStrictEqual({
          handle: "carol",
        });
      })
  );

  it.live.each([
    { handle: "admin", reason: "reserved", status: 400 },
    { handle: "-carol", reason: "letters, digits and dashes", status: 400 },
    { handle: "OSCABRIEL", reason: "taken", status: 409 },
  ])(
    "refuses the handle $handle by sign-up's rules, and asks again",
    ({ handle, reason, status }) =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        const refused = yield* chooseHandle(world, page, handle).pipe(
          Effect.flatMap(read)
        );

        expect([
          refused.response.status,
          isPickHandle(refused),
          refused.html.includes(reason),
          Option.isNone(codeOf(refused.response)),
        ]).toStrictEqual([status, true, true, true]);
        expect(
          yield* world.identities.handleOf("google", "1042")
        ).toStrictEqual(Option.none());
      })
  );

  it.live(
    "says a handle an account holds is taken, and keeps that account's",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        yield* world.accounts.create({
          handle: Handle.make("carol"),
          hash: yield* hashPassword(
            Redacted.make(passwordPepper),
            Redacted.make(alicePassword)
          ),
        });

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        const refused = yield* chooseHandle(world, page, "CAROL").pipe(
          Effect.flatMap(read)
        );

        expect([
          refused.response.status,
          refused.html.includes("taken"),
        ]).toStrictEqual([409, true]);
        expect(
          yield* world.identities.handleOf("google", "1042")
        ).toStrictEqual(Option.none());
      })
  );
});

const withAlice = (world: GoogleWorld) =>
  Effect.gen(function* () {
    yield* world.accounts.create({
      handle: Handle.make("alice"),
      hash: yield* hashPassword(
        Redacted.make(passwordPepper),
        Redacted.make(alicePassword)
      ),
    });
  });

describe("Google's email", () => {
  it.live(
    "signs straight into the account that proved the same address, and links Google to it",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        yield* world.accounts.create({
          email: Email.make(googleEmailOf("1042").toUpperCase()),
          handle: Handle.make("alice"),
          hash: yield* hashPassword(
            Redacted.make(passwordPepper),
            Redacted.make(alicePassword)
          ),
        });

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        expect(page.response.status).toBe(302);
        expect(yield* propsFor(world, page.response)).toStrictEqual({
          handle: "alice",
        });
        expect(
          yield* world.identities.handleOf("google", "1042")
        ).toStrictEqual(Option.some(Handle.make("alice")));
      })
  );

  it.live(
    "makes no account for a Google account whose email Google did not verify",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { claims: { email_verified: false }, sub: "1042" }
        );

        expect([
          page.response.status,
          page.html.includes("did not share a verified email"),
          isPickHandle(page),
          Option.isNone(codeOf(page.response)),
        ]).toStrictEqual([401, true, false, true]);
        expect(
          yield* world.identities.handleOf("google", "1042")
        ).toStrictEqual(Option.none());
      })
  );

  it.live(
    "asks an account linked before emails for one, when another account holds Google's",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        yield* withAlice(world);
        yield* world.identities.link("google", "5150", Handle.make("alice"));
        yield* world.accounts.create({
          email: Email.make(googleEmailOf("5150")),
          handle: Handle.make("bob"),
          hash: yield* hashPassword(
            Redacted.make(passwordPepper),
            Redacted.make(alicePassword)
          ),
        });

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "5150" }
        );

        expect([
          page.response.status,
          page.html.includes("Add your email"),
          Option.isNone(codeOf(page.response)),
        ]).toStrictEqual([200, true, true]);
      })
  );

  it.live("refuses a display name by sign-up's rule, and asks again", () =>
    Effect.gen(function* () {
      const world = yield* googleWorld();

      const page = yield* backFromGoogle(
        world,
        yield* continueWithGoogle(world),
        { sub: "1042" }
      );

      const refused = yield* chooseHandle(world, page, "carol", " ").pipe(
        Effect.flatMap(read)
      );

      expect([
        refused.response.status,
        isPickHandle(refused),
        refused.html.includes("display name"),
      ]).toStrictEqual([400, true, true]);
    })
  );
});

describe("Google not confirming anyone", () => {
  it.live.each([
    ["a signature by another key", "impostor"],
    ["another client's audience", "audience"],
    ["an expired token", "expired"],
    ["another sign-in's nonce", "nonce"],
  ] as const)(
    "refuses %s with the sign-in page and a plain message, and makes no account",
    ([, wrong]) =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const impostor = yield* world.google.keyPair("google-key-1");

        const consents = {
          audience: { claims: { aud: "another.apps.googleusercontent.com" } },
          expired: { claims: { exp: 1_700_000_000 } },
          impostor: { signWith: impostor },
          nonce: { claims: { nonce: "another-sign-in-s-nonce" } },
        } as const;

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { ...consents[wrong], sub: "1042" }
        );

        expect([
          page.response.status,
          Option.isSome(formOf(page.response, page.html, "kept")),
          page.html.includes("Google did not confirm who you are"),
          isPickHandle(page),
          Option.isNone(codeOf(page.response)),
        ]).toStrictEqual([401, true, true, false, true]);
        expect(
          yield* world.identities.handleOf("google", "1042")
        ).toStrictEqual(Option.none());
      })
  );

  it.live(
    "shows the sign-in page again when the person declines at Google",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const location = yield* Effect.fromOption(
          locationOf(yield* continueWithGoogle(world))
        ).pipe(Effect.orDie);

        const page = yield* visit(
          world,
          `/oauth/google/callback?error=access_denied&state=${encodeURIComponent(location.searchParams.get("state") ?? "")}`,
          "cross-site"
        ).pipe(Effect.flatMap(read));

        expect([
          page.response.status,
          page.html.includes("Google did not confirm who you are"),
          Option.isSome(formOf(page.response, page.html, "kept")),
        ]).toStrictEqual([401, true, true]);
      })
  );

  it.live(
    "refuses a state another platform sealed, a changed one, or one this browser did not start, and asks Google nothing",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        const otherKey = yield* googleWorld({
          cookieKey: "another-cookie-key-0123456789abcdef",
        });

        const otherBrowser = yield* googleWorld();

        const own = yield* Effect.fromOption(
          locationOf(yield* continueWithGoogle(world))
        ).pipe(Effect.orDie);

        const foreign = yield* Effect.fromOption(
          locationOf(yield* continueWithGoogle(otherKey))
        ).pipe(Effect.orDie);

        const state = own.searchParams.get("state") ?? "";

        const changed = new URL(own);

        changed.searchParams.set(
          "state",
          `${state.startsWith("A") ? "B" : "A"}${state.slice(1)}`
        );

        const attempts = [
          { location: foreign, world },
          { location: changed, world },
          { location: own, world: otherBrowser },
        ];

        for (const attempt of attempts) {
          const back = yield* attempt.world.google.consent(
            attempt.location.toString(),
            { sub: "1042" }
          );

          const page = yield* visit(
            attempt.world,
            back.toString(),
            "cross-site"
          ).pipe(Effect.flatMap(read));

          expect([
            page.response.status,
            page.html.includes("Start signing in again"),
            Option.isNone(codeOf(page.response)),
          ]).toStrictEqual([400, true, true]);
          expect(yield* attempt.world.google.exchanges).toStrictEqual([]);
        }
      })
  );
});

const signInAndLink = (world: GoogleWorld, handle: string, password: string) =>
  Effect.gen(function* () {
    const form = yield* formIn(yield* openSignIn(world));

    return yield* visit(
      world,
      formPost("/oauth/google/link", {
        csrf: form.csrf,
        login: handle,
        password,
        request: form.request,
      })
    );
  });

describe("linking Google to an account signed in by password", () => {
  it.live(
    "stores the Google account's subject against the handle, then signs in as it, now and by Google later",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        yield* withAlice(world);

        const toGoogle = yield* signInAndLink(world, "alice", alicePassword);

        expect(
          Option.map(locationOf(toGoogle), (url) => url.origin)
        ).toStrictEqual(Option.some("https://accounts.google.com"));

        const linked = yield* backFromGoogle(world, toGoogle, { sub: "5150" });

        expect(linked.response.status).toBe(302);
        expect(yield* propsFor(world, linked.response)).toStrictEqual({
          handle: "alice",
        });
        expect([
          yield* world.identities.handleOf("google", "5150"),
          Option.flatMap(
            yield* world.accounts.find(Handle.make("alice")),
            ({ email }) => Option.fromUndefinedOr(email)
          ),
        ]).toStrictEqual([
          Option.some(Handle.make("alice")),
          Option.some(googleEmailOf("5150")),
        ]);

        const later = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "5150" }
        );

        expect(yield* propsFor(world, later.response)).toStrictEqual({
          handle: "alice",
        });
      })
  );

  it.live("goes nowhere near Google with the wrong password", () =>
    Effect.gen(function* () {
      const world = yield* googleWorld();

      yield* withAlice(world);

      const page = yield* signInAndLink(
        world,
        "alice",
        "not the password"
      ).pipe(Effect.flatMap(read));

      expect([
        page.response.status,
        page.html.includes("The email, handle or password is wrong."),
        Option.isNone(locationOf(page.response)),
      ]).toStrictEqual([401, true, true]);
    })
  );

  it.live("refuses a Google account already linked to another handle", () =>
    Effect.gen(function* () {
      const world = yield* googleWorld();

      yield* withAlice(world);
      yield* world.identities.link("google", "5150", Handle.make("bob"));

      const page = yield* backFromGoogle(
        world,
        yield* signInAndLink(world, "alice", alicePassword),
        { sub: "5150" }
      );

      expect([
        page.response.status,
        page.html.includes("linked to another handle"),
        Option.isNone(codeOf(page.response)),
      ]).toStrictEqual([409, true, true]);
      expect(yield* world.identities.handleOf("google", "5150")).toStrictEqual(
        Option.some(Handle.make("bob"))
      );
    })
  );
});

describe("a sealed form, opened only where it was made", () => {
  it.live(
    "refuses a pick-a-handle form's seal as a password sign-in, or to start Google's",
    () =>
      Effect.gen(function* () {
        const world = yield* googleWorld();

        yield* withAlice(world);

        const page = yield* backFromGoogle(
          world,
          yield* continueWithGoogle(world),
          { sub: "1042" }
        );

        const form = yield* formIn(page);

        const answers = yield* Effect.forEach(
          [
            `/oauth/google/start?request=${encodeURIComponent(form.request)}`,
            formPost("/authorize", {
              csrf: form.csrf,
              login: "alice",
              password: alicePassword,
              request: form.request,
            }),
          ],
          (request) => visit(world, request).pipe(Effect.flatMap(read))
        );

        expect(
          answers.map(({ html, response }) => [
            response.status,
            html.includes("Start signing in again"),
          ])
        ).toStrictEqual([
          [400, true],
          [400, true],
        ]);
      })
  );
});
