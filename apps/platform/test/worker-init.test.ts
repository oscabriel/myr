/**
 * The Worker as Cloudflare starts it, in Node: `src/worker.ts` imported
 * through the `cloudflare:workers` shim, whose env is `fakeEnv()` (every
 * binding a fake that throws if touched; `PROJECT` a namespace of DOs that
 * hold no project). Then the ports `workerPorts` composes from a decoded
 * env, each over a fake of the binding it is built on.
 */
import { describe, expect, it } from "@effect/vitest";
import { Fetch } from "@repo/artifacts/fetch";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { FrontPage } from "@repo/project/front-page";
import { Lander, Rebuild } from "@repo/project/lander";
import type { LandJob } from "@repo/project/lander";
import { LandExit } from "@repo/project/lander/wire";
import {
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { Anonymous, Person } from "@repo/protocol/principal";
import { UnknownProject } from "@repo/protocol/refusal";
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import { untouchable } from "@repo/testkit/untouchable";
import { env } from "cloudflare:workers";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { vi } from "vitest";

import type { SandboxBinding } from "../src/adapters/check-runner-sandbox.ts";
import { AccountsMemory } from "../src/auth/accounts/memory.ts";
import { SignInAttemptsMemory } from "../src/auth/attempts/memory.ts";
import { IdentitiesMemory } from "../src/auth/identities/memory.ts";
import { OAuthStore } from "../src/auth/oauth-store.ts";
import { OAuthStoreMemory } from "../src/auth/oauth-store/memory.ts";
import { oauthProvider, signInSettings } from "../src/auth/provider.ts";
import { decodeEnv, PlatformEnv, platformOf } from "../src/platform.ts";
import { workerPorts } from "../src/ports.ts";
import { serve } from "../src/surfaces.ts";
import worker from "../src/worker.ts";
import { callsTo, fakeEnv, fakeProjects } from "./fake-env.ts";
import { origin, rpcClient } from "./harness.ts";
import {
  authorizeUrl,
  codeOf,
  formOf,
  post,
  origin as signInOrigin,
  tokenRequest,
} from "./oauth.fixtures.ts";

/**
 * What the shim's `PROJECT` was sent while `src/worker.ts` loaded, read
 * before any test runs: importing the module built its handler, and any
 * other binding it read would have thrown there.
 */
const sentWhileLoading = [...callsTo(env.PROJECT)];

/** A Worker's context, which nothing here needs. */
const context = untouchable<ExecutionContext>("ExecutionContext");

/** The Worker module's own fetch, as Cloudflare calls it, with the shim's env. */
const workerFetch = (request: Request) =>
  Promise.resolve(worker.fetch(request, env, context));

const nowhere = ProjectName.make("nowhere");

const datekit = ProjectName.make("datekit");

const canonical = RepoName.make("datekit");

const landed = LandedSha.make("7".repeat(40));

/** A land of a commit the answer already made, onto canonical `main`. */
const landJob: LandJob = {
  author: Handle.make("alice"),
  main: LandedSha.make("4".repeat(40)),
  message: "Fix the parser\n\nRequest-Id: request-0001\n",
  rebuild: Rebuild.Existing({ commit: CommitSha.make("6".repeat(40)) }),
  repo: canonical,
  requestId: RequestId.make("request-0001"),
  tree: TreeSha.make("5".repeat(40)),
  verdict: Option.none(),
};

/** Where the fake Artifacts binding says each repo's git lives. */
const artifactsBase = "https://artifacts.test";

/**
 * The global `fetch`, for the test's length, as a stub that notes each URL
 * it is asked for and answers 503: the Worker's `Fetch` port goes through
 * it, so nothing here reaches a network.
 */
const fetchedUrls = Effect.acquireRelease(
  Effect.sync(() => {
    const urls: string[] = [];

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      urls.push(new Request(input).url);

      return Promise.resolve(new Response(null, { status: 503 }));
    });

    return urls;
  }),
  () => Effect.sync(() => vi.unstubAllGlobals())
);

/**
 * The sandbox Worker's entrypoint as the `SANDBOX` binding reaches it: a
 * land answers `landed`, and each land's request id is noted; anything
 * else read from it throws.
 */
const fakeSandbox = () => {
  const lands: string[] = [];

  const sandbox = untouchable<Env["SANDBOX"] & SandboxBinding>("SANDBOX", {
    land: (wire) => {
      lands.push(wire.job.requestId);

      return Promise.resolve(
        Schema.encodeSync(LandExit)(Exit.succeed({ pending: [], sha: landed }))
      );
    },
  });

  return { lands, sandbox };
};

/**
 * One land through the ports `workerPorts` composes for `LANDER_ADAPTER`,
 * over a fake Artifacts binding that holds the canonical repo and a fake
 * sandbox: what the land came to, which lands the sandbox was sent, and
 * which URLs the Worker fetched.
 */
const landThrough = (adapter: "container" | "isogit") =>
  Effect.gen(function* () {
    const urls = yield* fetchedUrls;

    const host = yield* Effect.provide(
      Effect.service(RepoHost),
      RepoHostMemory
    );

    yield* host.create(canonical);

    const { lands, sandbox } = fakeSandbox();

    const config = yield* decodeEnv({
      ...fakeEnv(),
      ARTIFACTS: fakeArtifactsBinding(host, { remoteBase: artifactsBase }),
      LANDER_ADAPTER: adapter,
      SANDBOX: sandbox,
    }).pipe(Effect.orDie);

    const outcome = yield* Effect.exit(
      Lander.use((lander) => lander.land(landJob)).pipe(
        Effect.provide(workerPorts(config))
      )
    );

    return { fetched: [...urls], lands: [...lands], outcome };
  });

/** What `/health` answers. */
const Health = Schema.fromJsonString(
  Schema.Struct({ ok: Schema.Boolean, stage: Schema.String })
);

/** A response's body, decoded by `schema`; one that won't decode is the test's defect. */
const bodyOf =
  <A>(schema: Schema.Codec<A, string>) =>
  (response: Response) =>
    Effect.promise(() => response.text()).pipe(
      Effect.flatMap(Schema.decodeEffect(schema)),
      Effect.orDie
    );

describe("the Worker module", () => {
  it.effect(
    "builds its handler from the env without touching a binding, and answers /health",
    () =>
      Effect.gen(function* () {
        expect(sentWhileLoading).toStrictEqual([]);

        const before = callsTo(env.PROJECT).length;

        const health = yield* Effect.promise(() =>
          workerFetch(new Request(`${origin}/health`))
        );

        expect(health.status).toBe(200);
        expect(yield* bodyOf(Health)(health)).toStrictEqual({
          ok: true,
          stage: "local",
        });
        expect(callsTo(env.PROJECT).slice(before)).toStrictEqual([]);
      })
  );

  it.effect(
    "asks the project's Durable Object for its asks, anonymously, and answers UnknownProject for one never made",
    () =>
      Effect.gen(function* () {
        const before = callsTo(env.PROJECT).length;

        const anyone = yield* rpcClient(workerFetch);

        expect(
          yield* Effect.exit(anyone.listAsks({ project: nowhere }))
        ).toStrictEqual(Exit.fail(new UnknownProject({ project: nowhere })));
        expect(callsTo(env.PROJECT).slice(before)).toStrictEqual([
          { caller: Anonymous.make({}), method: "listAsks", project: nowhere },
        ]);
      })
  );
});

describe("the Worker's ports", () => {
  it.effect(
    "land through the sandbox's Lander when LANDER_ADAPTER is container",
    () =>
      Effect.gen(function* () {
        const { fetched, lands, outcome } = yield* landThrough("container");

        expect(outcome).toStrictEqual(
          Exit.succeed({ pending: [], sha: landed })
        );
        expect(lands).toStrictEqual([landJob.requestId]);
        expect(fetched).toStrictEqual([]);
      })
  );

  it.effect(
    "land in the Worker with isomorphic-git over the Artifacts binding when LANDER_ADAPTER is isogit",
    () =>
      Effect.gen(function* () {
        const { fetched, lands } = yield* landThrough("isogit");

        expect(lands).toStrictEqual([]);
        expect(fetched).toContain(
          `${artifactsBase}/${canonical}.git/info/refs?service=git-upload-pack`
        );
      })
  );

  it.effect("read the front page from the FRONT_PAGE database", () =>
    Effect.gen(function* () {
      const prepared: string[] = [];

      const result: D1Result = {
        meta: {
          changed_db: false,
          changes: 0,
          duration: 0,
          last_row_id: 0,
          rows_read: 0,
          rows_written: 0,
          size_after: 0,
        },
        results: [],
        success: true,
      };

      const database = untouchable<D1Database>("FRONT_PAGE", {
        prepare: (query) => {
          prepared.push(query);

          return untouchable<D1PreparedStatement>("D1PreparedStatement", {
            bind: () =>
              untouchable<D1PreparedStatement>("D1PreparedStatement", {
                all: <T>() =>
                  Promise.resolve<D1Result<T>>({ ...result, results: [] }),
              }),
          });
        },
      });

      const config = yield* decodeEnv({
        ...fakeEnv(),
        FRONT_PAGE: database,
      }).pipe(Effect.orDie);

      const entries = yield* Effect.exit(
        FrontPage.use((page) => page.entries({})).pipe(
          Effect.provide(workerPorts(config))
        )
      );

      expect(entries).toStrictEqual(Exit.succeed([]));
      expect(prepared).toHaveLength(1);
      expect(prepared[0]).toContain("FROM front_page");
    })
  );
});

/** A sign-in page's text, beside its response. */
const pageOf = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.text()),
    (html) => ({ html, response })
  );

/** What `/token` answers, as far as a client reads it. */
const AccessToken = Schema.fromJsonString(
  Schema.Struct({ access_token: Schema.String })
);

/** The sign-in form `page` carries; the test dies if it carries none. */
const formIn = (
  page: { readonly html: string; readonly response: Response },
  cookie?: string
) => Effect.orDie(Effect.fromOption(formOf(page.response, page.html, cookie)));

/**
 * The platform as `worker.ts` puts it together, OAuth and sign-in in front,
 * over the fake env with its `OAUTH_KV` in memory and a Project DO for
 * datekit (accounts in memory too), and an access token for a new account
 * `handle`, by the CLI's PKCE flow: sign up from the sign-in page, then
 * trade the code for a token. The global `fetch` answers the client
 * metadata document from the Worker itself, as the public internet does on
 * Cloudflare.
 */
const signedUp = (handle: string, password: string) =>
  Effect.gen(function* () {
    const store = OAuthStoreMemory.make();

    const config = yield* Schema.decodeUnknownEffect(PlatformEnv)({
      ...fakeEnv(),
      OAUTH_KV: store,
      PROJECT: fakeProjects([datekit]),
    }).pipe(Effect.orDie);

    const { dispose: disposePlatform, handler: platformFetch } = serve(
      platformOf(config)
    );

    const { dispose, handler } = oauthProvider(
      Layer.mergeAll(
        AccountsMemory.layer,
        Layer.succeed(OAuthStore, store),
        // No Google client in the fake env: Google sign-in touches neither (W4 419).
        IdentitiesMemory.layer,
        Layer.succeed(Fetch, untouchable<Fetch["Service"]>("Fetch")),
        SignInAttemptsMemory.layer,
        signInSettings(config)
      ),
      (request) => platformFetch(request)
    );

    const send = (request: Request) => handler.fetch(request, env, context);

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        vi.stubGlobal("Cloudflare", {
          compatibilityFlags: { global_fetch_strictly_public: true },
        });
        vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
          send(new Request(input))
        );
      }),
      () =>
        Effect.all([
          Effect.promise(dispose),
          Effect.promise(disposePlatform),
          Effect.sync(() => vi.unstubAllGlobals()),
        ])
    );

    const fetch = (request: Request) => Effect.promise(() => send(request));

    const signIn = yield* formIn(
      yield* Effect.flatMap(fetch(new Request(authorizeUrl())), pageOf)
    );

    const signUpPage = yield* Effect.flatMap(
      fetch(
        new Request(
          new URL(
            `/signup?request=${encodeURIComponent(signIn.request)}`,
            signInOrigin
          )
        )
      ),
      pageOf
    );

    const form = yield* formIn(signUpPage, signIn.cookie);

    const code = yield* fetch(
      post(
        "/signup",
        { csrf: form.csrf, handle, password, request: form.request },
        form.cookie
      )
    ).pipe(
      Effect.flatMap((response) => Effect.fromOption(codeOf(response))),
      Effect.orDie
    );

    const { access_token } = yield* fetch(tokenRequest(code)).pipe(
      Effect.flatMap(bodyOf(AccessToken))
    );

    return { accessToken: access_token, config, send };
  });

describe("the Worker's sessions", () => {
  it.live(
    "let an OAuth access token from sign-in call status over /rpc as its person",
    () =>
      Effect.gen(function* () {
        const { accessToken, config, send } = yield* signedUp(
          "alice",
          "correct horse battery"
        );

        const alice = yield* rpcClient((request) => send(request), accessToken);

        expect(
          yield* Effect.exit(alice.status({ project: datekit }))
        ).toStrictEqual(Exit.succeed({ answers: [], claims: [] }));
        expect(
          callsTo(config.PROJECT).filter(({ method }) => method === "status")
        ).toStrictEqual([
          {
            caller: Person.make({ handle: Handle.make("alice") }),
            method: "status",
            project: datekit,
          },
        ]);
      })
  );

  it.live("turn away an access token sign-in never issued, with a 401", () =>
    Effect.gen(function* () {
      const { accessToken, send } = yield* signedUp(
        "alice",
        "correct horse battery"
      );

      // The same user and grant, another secret: the provider knows no such token.
      const forged = [...accessToken.split(":").slice(0, 2), "forged"].join(
        ":"
      );

      const response = yield* Effect.promise(() =>
        send(
          new Request(`${origin}/rpc`, {
            body: "[]",
            headers: {
              authorization: `Bearer ${forged}`,
              "content-type": "application/json",
            },
            method: "POST",
          })
        )
      );

      expect(response.status).toBe(401);
    })
  );
});
