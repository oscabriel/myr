/**
 * Opt-in, never in `verify`: runs only with `LIVE_ARTIFACTS=1` and
 * `LIVE_ARTIFACTS_HARNESS` naming, by absolute path, a harness module outside
 * this repo. The harness exports `live()`, which resolves to
 *
 * ```ts
 * {
 *   namespace: string;                        // a namespace this build made
 *   binding: Artifacts;                       // `getPlatformProxy({ remoteBindings: true })`'s `env.ARTIFACTS`
 *   fetch: (request: Request) => Promise<Response>;
 *   dispose: () => Promise<void>;             // the proxy's
 * }
 * ```
 */
import { describe } from "@effect/vitest";
import { Data, Effect, FiberSet, Layer, Predicate, Schema } from "effect";

import { Fetch, FetchFailed } from "../src/fetch.ts";
import { RepoHostBinding } from "../src/repo-host/binding.ts";
import { describeRepoHost } from "./repo-host-contract.ts";

const FORBIDDEN = "witness";

const harnessPath = process.env.LIVE_ARTIFACTS_HARNESS;

const live = process.env.LIVE_ARTIFACTS === "1" && harnessPath !== undefined;

// The harness's functions, taken on trust as its doc comment types them:
// a function's signature cannot be checked at run time.

const Start = Schema.declare((input): input is () => Promise<object> =>
  Predicate.isFunction(input)
);

const Dispose = Schema.declare((input): input is () => Promise<void> =>
  Predicate.isFunction(input)
);

const Send = Schema.declare(
  (input): input is (request: Request) => Promise<Response> =>
    Predicate.isFunction(input)
);

const HarnessModule = Schema.Struct({ live: Start });

const Harness = Schema.Struct({
  binding: Schema.declare(
    (input): input is Artifacts =>
      Predicate.hasProperty(input, "get") && Predicate.isFunction(input.get)
  ),
  dispose: Dispose,
  fetch: Send,
  namespace: Schema.NonEmptyString.pipe(
    Schema.check(
      Schema.makeFilter((namespace) =>
        namespace === FORBIDDEN
          ? `${FORBIDDEN} belongs to another project`
          : undefined
      )
    )
  ),
});

type Harness = typeof Harness.Type;

class HarnessFailed extends Data.TaggedError("HarnessFailed")<{
  readonly reason: string;
}> {}

const harness = (path: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const module = yield* Effect.tryPromise({
        catch: () => new HarnessFailed({ reason: `cannot import ${path}` }),
        try: () => import(path),
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(HarnessModule)));

      return yield* Effect.tryPromise({
        catch: () => new HarnessFailed({ reason: "live() rejected" }),
        try: () => module.live(),
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Harness)));
    }).pipe(Effect.orDie),
    ({ dispose }) => Effect.tryPromise(() => dispose()).pipe(Effect.ignore)
  );

const freshPrefix = () =>
  `live-${crypto
    .getRandomValues(new Uint32Array(2))
    .reduce((text, word) => text + word.toString(36), "")}-`;

/** Each method is forwarded by name: RPC stubs' methods are not copied by a spread. */
const prefixed = (binding: Artifacts) =>
  Effect.gen(function* () {
    const prefix = freshPrefix();
    const run = yield* FiberSet.makeRuntimePromise();
    const made = new Set<string>();

    const named = (name: string) => {
      made.add(`${prefix}${name}`);

      return `${prefix}${name}`;
    };

    yield* Effect.addFinalizer(() =>
      Effect.forEach(made, (name) =>
        Effect.tryPromise(() => binding.delete(name)).pipe(Effect.ignore)
      )
    );

    const handle = (repo: ArtifactsRepo): ArtifactsRepo => ({
      createToken: (scope, ttl) => repo.createToken(scope, ttl),
      fork: (target, options) => repo.fork(named(target), options),
      info: () => repo.info(),
      listTokens: () => repo.listTokens(),
      log: (options) => repo.log(options),
      readBlob: (hash) => repo.readBlob(hash),
      readCommit: (hash) => repo.readCommit(hash),
      readFile: (args) => repo.readFile(args),
      readTree: (hash) => repo.readTree(hash),
      revokeToken: (tokenOrId) => repo.revokeToken(tokenOrId),
      [Symbol.dispose]: () => {
        repo[Symbol.dispose]();
      },
    });

    return {
      create: (name, options) => binding.create(named(name), options),
      delete: (name) => binding.delete(`${prefix}${name}`),
      get: (name) =>
        run(
          Effect.promise(() => binding.get(`${prefix}${name}`)).pipe(
            Effect.map(handle)
          )
        ),
      import: ({ source, target }) =>
        binding.import({
          source,
          target: { ...target, name: named(target.name) },
        }),
      list: (options) => binding.list(options),
    } satisfies Artifacts;
  });

const fetchOver = (send: Harness["fetch"]) =>
  Fetch.of({
    fetch: (request) =>
      Effect.tryPromise({
        catch: (cause) =>
          new FetchFailed({
            reason: cause instanceof Error ? cause.message : "no response",
            url: request.url,
          }),
        try: () => send(request),
      }),
  });

describe.runIf(live)("against live Artifacts", () => {
  // Artifacts imports only public HTTPS remotes, and its own refuse anonymous
  // reads, so the import cases do not run here.
  describeRepoHost(
    "binding (live)",
    Layer.unwrap(
      Effect.gen(function* () {
        const { binding, fetch } = yield* harness(harnessPath ?? "");

        return RepoHostBinding.layer(yield* prefixed(binding)).pipe(
          Layer.provide(Layer.succeed(Fetch, fetchOver(fetch)))
        );
      })
    )
  );
});
