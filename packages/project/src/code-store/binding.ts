import {
  Clock,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
} from "effect";

import { CodeStore, fittingKey } from "../code-store.ts";
import type { CodeStoreApi } from "../code-store.ts";

/** Structural, so the package needs no Workers types. */
export interface BucketLike {
  readonly get: (
    key: string
  ) => Promise<{ readonly text: () => Promise<string> } | null>;
  readonly put: (
    key: string,
    value: string
  ) => Promise<{ readonly key: string } | null>;
}

/** The colo's cache (`caches.default`), structural as the bucket is. */
export interface EdgeCacheLike {
  readonly match: (url: string) => Promise<Response | undefined>;
  readonly put: (url: string, response: Response) => Promise<void>;
}

/**
 * How long a write this isolate started holds its key: R2 refuses a second
 * write to one object while a first is under way, and a page's reads, each
 * its own request, ask for the same commit at once. A write that never ends
 * (its request cancelled where it stands) lets its key go when the hold lapses.
 */
export const WRITE_HELD = Duration.minutes(1);

/** The most keys held at once; past it, the oldest hold is let go. */
export const WRITES_HELD = 4096;

/**
 * The keys this isolate wrote lately, and when. What a key names never
 * changes, so a write the hold skips is the one already under way or done; a
 * failed write lets its key go at once, for the next read to keep.
 */
const writeHolds = () => {
  const started = new Map<string, number>();
  const held = Duration.toMillis(WRITE_HELD);

  return {
    let: (key: string) =>
      Effect.sync(() => {
        started.delete(key);
      }),
    take: (key: string) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const since = started.get(key);

        if (since !== undefined && now - since < held) {
          return false;
        }

        started.delete(key);
        started.set(key, now);

        if (started.size > WRITES_HELD) {
          const [oldest] = started.keys();

          if (oldest !== undefined) {
            started.delete(oldest);
          }
        }

        return true;
      }),
  };
};

type WriteHolds = ReturnType<typeof writeHolds>;

/**
 * R2's failure, logged with its name and numeric code (10058 is a write
 * refused while another to the object is under way). Never its text, and
 * never the error itself, which a Worker's log line would carry as an empty
 * object.
 */
const unreached = (said: string, cause: unknown) => {
  const warned = Effect.logWarning(said).pipe(
    Effect.annotateLogs(
      "failure",
      Predicate.hasProperty(cause, "name") && Predicate.isString(cause.name)
        ? cause.name
        : "Unknown"
    )
  );

  return Predicate.hasProperty(cause, "code") && Predicate.isNumber(cause.code)
    ? Effect.annotateLogs(warned, "code", cause.code)
    : warned;
};

class CodeStoreUnreachable extends Data.TaggedError("CodeStoreUnreachable")<{
  readonly cause: unknown;
}> {}

const reach = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => new CodeStoreUnreachable({ cause }),
    try: run,
  });

// `.invalid` never resolves, so no visitor's request can reach an entry: only this
// Worker's own `match` reads one. Every key is an object id, or a commit with an
// algorithm version, so an entry never goes stale and is kept for a month.
const edgeUrl = (key: string) =>
  `https://code-store.invalid/${encodeURIComponent(key)}`;

const EDGE_KEPT = "public, max-age=2592000";

// The colo's cache only spares R2 a trip, so its failures are misses, logged below a warning.
const edgeReads = (edge: () => EdgeCacheLike) => ({
  get: (key: string) =>
    reach(() => edge().match(edgeUrl(key))).pipe(
      Effect.flatMap((found) =>
        found === undefined
          ? Effect.succeedNone
          : Effect.asSome(reach(() => found.text()))
      ),
      Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
        Effect.as(
          Effect.logDebug(`the colo's cache could not read ${key}`, cause),
          Option.none<string>()
        )
      )
    ),
  put: (key: string, value: string) =>
    reach(() =>
      edge().put(
        edgeUrl(key),
        new Response(value, { headers: { "cache-control": EDGE_KEPT } })
      )
    ).pipe(
      Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
        Effect.logDebug(`the colo's cache could not keep ${key}`, cause)
      )
    ),
});

const storeOver = (
  bucket: BucketLike,
  holds: WriteHolds,
  edge?: () => EdgeCacheLike
): CodeStoreApi => {
  const front = edge === undefined ? undefined : edgeReads(edge);

  const fromBucket = (fit: string) =>
    reach(() => bucket.get(fit)).pipe(
      Effect.flatMap((found) =>
        found === null
          ? Effect.succeedNone
          : Effect.asSome(reach(() => found.text()))
      ),
      Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
        Effect.as(
          unreached(`the code store could not read ${fit}`, cause),
          Option.none<string>()
        )
      )
    );

  const toBucket = (fit: string, value: string): Effect.Effect<void> =>
    reach(() => bucket.put(fit, value)).pipe(
      Effect.asVoid,
      Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
        Effect.andThen(
          holds.let(fit),
          unreached(`the code store could not keep ${fit}`, cause)
        )
      ),
      Effect.onInterrupt(() => holds.let(fit))
    );

  const store: CodeStoreApi = {
    get: (key) =>
      Effect.flatMap(fittingKey(key), (fit) =>
        front === undefined
          ? fromBucket(fit)
          : Effect.flatMap(
              front.get(fit),
              Option.match({
                onNone: () =>
                  Effect.tap(
                    fromBucket(fit),
                    Option.match({
                      onNone: () => Effect.void,
                      onSome: (found) => front.put(fit, found),
                    })
                  ),
                onSome: (kept) => Effect.succeedSome(kept),
              })
            )
      ),
    put: (key, value) =>
      Effect.gen(function* () {
        const fit = yield* fittingKey(key);

        if (!(yield* holds.take(fit))) {
          return;
        }

        yield* front === undefined
          ? toBucket(fit, value)
          : Effect.all([toBucket(fit, value), front.put(fit, value)], {
              concurrency: "unbounded",
              discard: true,
            });
      }),
  };

  return store;
};

/**
 * R2, with the colo's cache in front when one is given: a few milliseconds on
 * a hit where R2 takes a hundred, which a cold isolate's chain of reads feels.
 * Each build holds its own writes (see `WRITE_HELD`): the Worker's one build
 * holds them for the isolate.
 */
export const CodeStoreR2 = (bucket: BucketLike, edge?: () => EdgeCacheLike) =>
  Layer.effect(
    CodeStore,
    Effect.sync(() => storeOver(bucket, writeHolds(), edge))
  );
