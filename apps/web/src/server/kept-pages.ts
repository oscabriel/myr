// An agent's document (`/llms.txt`, a project's, an ask's Markdown, the agent skills index) names no hashed asset,
// so a copy of it is still whole after a deploy. Workers Cache keeps it per Worker version, and answers the first
// reader after it expires, and every first reader after a deploy, only once the Worker has read the platform again.
// So the Worker keeps its last answer to each in its colo's Cache API as well, hands it back at once while it is no
// older than the edge's stale window, and reads it again in the background once it is past the route's `max-age`.
// A request that says who is reading is neither handed a kept answer nor kept, as at the edge, and so is any answer
// but a 200 that may be kept for a while.
import { waitUntil } from "cloudflare:workers";
import { Clock, Effect, Option, Schema } from "effect";

import { EDGE_STALE_SECONDS, speaksForSomeone } from "./edge-cache.ts";

/** One answer as it was kept, and the instant, in epoch milliseconds, it was read from the platform. */
export interface KeptPage {
  readonly body: string;
  readonly cacheControl: string;
  readonly contentType: string;
  readonly keptAt: number;
}

export interface PageKeeper {
  readonly get: (key: string) => Effect.Effect<Option.Option<KeptPage>>;
  readonly put: (key: string, page: KeptPage) => Effect.Effect<void>;
  /** Runs the work after the answer has gone, as the request's own. */
  readonly inBackground: (work: Effect.Effect<void>) => Effect.Effect<void>;
}

const directivesOf = (cacheControl: string) =>
  cacheControl
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter((directive) => directive !== "");

// An answer kept by nobody, or one that forbids serving it stale, is never kept here either.
const NOT_KEPT = new Set([
  "private",
  "no-store",
  "no-cache",
  "must-revalidate",
  "proxy-revalidate",
]);

const MAX_AGE = "max-age=";

const MaxAge = Schema.FiniteFromString.check(Schema.isGreaterThan(0));

const decodeMaxAge = Schema.decodeUnknownOption(MaxAge);

/** How long the route says its answer is fresh, in seconds; none when it may not be kept. */
const maxAgeOf = (cacheControl: string): Option.Option<number> => {
  const directives = directivesOf(cacheControl);

  const forbids = directives.some(
    (directive) =>
      NOT_KEPT.has(directive) ||
      directive.startsWith("private=") ||
      directive.startsWith("no-cache=")
  );

  return forbids
    ? Option.none()
    : Option.firstSomeOf(
        directives.map((directive) =>
          directive.startsWith(MAX_AGE)
            ? decodeMaxAge(directive.slice(MAX_AGE.length))
            : Option.none()
        )
      );
};

// Kept by its path alone, so a query string never makes a second copy.
export const keptKeyOf = (request: Request) => {
  const { origin, pathname } = new URL(request.url);

  return `${origin}${pathname}`;
};

const answerOf = ({ body, cacheControl, contentType }: KeptPage) =>
  new Response(body, {
    headers: { "cache-control": cacheControl, "content-type": contentType },
    status: 200,
  });

const keepable = (response: Response) => {
  const cacheControl = response.headers.get("cache-control");
  const contentType = response.headers.get("content-type");

  return response.status !== 200 ||
    response.headers.has("set-cookie") ||
    cacheControl === null ||
    contentType === null ||
    Option.isNone(maxAgeOf(cacheControl))
    ? Option.none()
    : Option.some({ cacheControl, contentType });
};

/**
 * The route's answer, kept when it may be. It is read whole, since a page an
 * agent reads is a few kilobytes of text.
 */
const readAndKeep = (
  keeper: PageKeeper,
  key: string,
  render: Effect.Effect<Response>
) =>
  Effect.gen(function* () {
    const response = yield* render;
    const kept = keepable(response);

    if (Option.isNone(kept)) {
      return response;
    }

    const page: KeptPage = {
      ...kept.value,
      body: yield* Effect.promise(() => response.text()),
      keptAt: yield* Clock.currentTimeMillis,
    };

    yield* keeper.inBackground(keeper.put(key, page));

    return answerOf(page);
  });

const MILLIS = 1000;

/**
 * The kept answer while it is fresh, and while it is stale within the edge's
 * window, with the route read again in the background; the route's own answer
 * otherwise.
 */
export const servedKept =
  (keeper: PageKeeper) =>
  (
    request: Request,
    render: Effect.Effect<Response>
  ): Effect.Effect<Response> =>
    Effect.gen(function* () {
      if (request.method !== "GET" || speaksForSomeone(request)) {
        return yield* render;
      }

      const key = keptKeyOf(request);
      const kept = yield* keeper.get(key);

      if (Option.isNone(kept)) {
        return yield* readAndKeep(keeper, key, render);
      }

      const page = kept.value;
      const age = (yield* Clock.currentTimeMillis) - page.keptAt;
      const fresh = Option.getOrElse(maxAgeOf(page.cacheControl), () => 0);

      if (age <= fresh * MILLIS) {
        return answerOf(page);
      }

      if (age <= (fresh + EDGE_STALE_SECONDS) * MILLIS) {
        yield* keeper.inBackground(
          Effect.asVoid(readAndKeep(keeper, key, render))
        );

        return answerOf(page);
      }

      return yield* readAndKeep(keeper, key, render);
    });

/** A route's handler with its answer kept by `keeper`. */
export const keptBy =
  (keeper: PageKeeper) =>
  <Args extends { readonly request: Request }>(
    handler: (args: Args) => Promise<Response> | Response
  ) =>
  (args: Args): Promise<Response> =>
    Effect.runPromise(
      servedKept(keeper)(
        args.request,
        Effect.promise(() => Promise.resolve(handler(args)))
      )
    );

const KeptHeaders = Schema.Struct({
  cacheControl: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  keptAt: Schema.FiniteFromString,
});

const decodeKeptHeaders = Schema.decodeUnknownOption(KeptHeaders);

const KEPT_AT = "x-kept-at";

const KEPT_CACHE_CONTROL = "x-kept-cache-control";

const quietly = (work: Effect.Effect<void>) =>
  Effect.catchCause(work, (cause) =>
    Effect.logWarning("an agent's page was not kept", cause)
  );

/**
 * A cache of the colo's Cache API, which keeps an entry for as long as its own
 * `Cache-Control` says: the route's age and the edge's stale window. A failed
 * read is a miss, and a failed write keeps nothing.
 */
export const cacheApiKeeper = (
  open: () => Promise<Cache>,
  background: (promise: Promise<unknown>) => void
): PageKeeper => ({
  get: (key) =>
    Effect.tryPromise(open).pipe(
      Effect.flatMap((cache) => Effect.tryPromise(() => cache.match(key))),
      Effect.flatMap((found) =>
        found === undefined
          ? Effect.succeedNone
          : Option.match(
              decodeKeptHeaders({
                cacheControl: found.headers.get(KEPT_CACHE_CONTROL),
                contentType: found.headers.get("content-type"),
                keptAt: found.headers.get(KEPT_AT),
              }),
              {
                onNone: () =>
                  Effect.as(
                    Effect.tryPromise(
                      () => found.body?.cancel() ?? Promise.resolve()
                    ),
                    Option.none<KeptPage>()
                  ),
                onSome: (headers) =>
                  Effect.map(
                    Effect.tryPromise(() => found.text()),
                    (body) => Option.some({ ...headers, body })
                  ),
              }
            )
      ),
      Effect.orElseSucceed(Option.none<KeptPage>)
    ),
  inBackground: (work) =>
    Effect.sync(() => {
      background(Effect.runPromise(quietly(work)));
    }),
  put: (key, page) =>
    Effect.tryPromise(open).pipe(
      Effect.flatMap((cache) =>
        Effect.tryPromise(() =>
          cache.put(
            key,
            new Response(page.body, {
              headers: {
                "cache-control": `public, max-age=${
                  Option.getOrElse(maxAgeOf(page.cacheControl), () => 0) +
                  EDGE_STALE_SECONDS
                }`,
                "content-type": page.contentType,
                [KEPT_AT]: String(page.keptAt),
                [KEPT_CACHE_CONTROL]: page.cacheControl,
              },
            })
          )
        )
      ),
      Effect.ignore
    ),
});

/** Keeps nothing, so every request reads the route: `vite dev`'s, as Workers Cache is off there too. */
export const keepsNothing: PageKeeper = {
  get: () => Effect.succeedNone,
  inBackground: () => Effect.void,
  put: () => Effect.void,
};

// A cache of its own, so no entry in it is ever the edge's answer to a page.
const AGENT_PAGES = "agent-pages";

/** The deployed Worker's keeper, a cache of the colo's own; `vite dev` keeps nothing. */
export const keptPage = keptBy(
  import.meta.env.PROD
    ? cacheApiKeeper(() => caches.open(AGENT_PAGES), waitUntil)
    : keepsNothing
);
