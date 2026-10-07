/**
 * The CLI's releases, served by the platform itself (issue 420): anyone,
 * with no account and no token, runs `curl -fsSL <origin>/install.sh | sh`.
 * W7 715 uploads each release into the stage's `RELEASES` bucket beside
 * `releases/manifest.json`, which says what each version holds; nothing
 * about a release lives anywhere else.
 */
import { Brand } from "@repo/brand";
import type { Layer } from "effect";
import {
  Array,
  Context,
  Data,
  Effect,
  Option,
  Order,
  Record,
  Schema,
} from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";

/** One stored file: its bytes, whole or as a stream, and how many there are. */
export interface ReleaseFile {
  readonly body: ReadableStream | Uint8Array;
  readonly size: number;
}

/**
 * Where releases are kept: the stage's `RELEASES` bucket
 * (`releases/binding.ts`), or memory (`releases/memory.ts`). Read-only:
 * W7 715 uploads.
 */
export class ReleaseStore extends Context.Service<
  ReleaseStore,
  {
    /** The file kept under `key`, if any. */
    readonly get: (key: string) => Effect.Effect<Option.Option<ReleaseFile>>;
  }
>()("platform/ReleaseStore") {}

/** A sha256 digest, as `sha256sum` prints it: 64 lowercase hex digits. */
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

/**
 * A version as W7 715 numbers releases: semver, with an optional
 * pre-release, and so never `latest`, a `/` or a `..`.
 */
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

/** A file name inside a version's folder: never a `/`, and never a leading dot. */
const FILE_NAME = /^[0-9A-Za-z][0-9A-Za-z._-]*$/u;

/**
 * Every key of a record matches `pattern`. Checked whole: a record with a
 * refined key would drop a bad entry without a word (spec §7.4).
 */
const keysMatch = (pattern: RegExp, what: string) =>
  Schema.makeFilter((record: Readonly<Record<string, unknown>>) =>
    Object.keys(record).every((key) => pattern.test(key))
      ? true
      : `every key is ${what}`
  );

/** One file of a release: its size and its digest. */
const Asset = Schema.Struct({
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sha256: Sha256,
});

type Asset = typeof Asset.Type;

/** What one version holds, by file name. */
const Release = Schema.Struct({
  assets: Schema.Record(Schema.String, Asset).check(
    keysMatch(FILE_NAME, "a file name")
  ),
});

type Release = typeof Release.Type;

/**
 * `releases/manifest.json`, as W7 715's `releaseManifest` writes it: every
 * version released, by version, and which one is latest. Decoded at the
 * boundary (principle 2), so a version or a file name from it never leaves
 * `releases/<version>/`.
 */
export const ReleaseManifest = Schema.Struct({
  latest: Schema.String.check(Schema.isPattern(VERSION)),
  versions: Schema.Record(Schema.String, Release).check(
    keysMatch(VERSION, "a version")
  ),
}).check(
  Schema.makeFilter(({ latest, versions }) =>
    Object.hasOwn(versions, latest) ? true : "latest is a version it lists"
  )
);

export type ReleaseManifest = typeof ReleaseManifest.Type;

/**
 * What a release is built for (W7 715's targets, without Bun's `bun-`
 * prefix). A binary is named for the slug and its target, and nothing else
 * is served as one.
 */
const releaseTargets = ["linux-x64", "darwin-arm64"] as const;

/** Where the manifest is kept, and served; every release file is under `releases/`. */
const MANIFEST_KEY = "releases/manifest.json";

const MANIFEST_PATH = `/${MANIFEST_KEY}`;

/** Each version's checksum file, made from its manifest entry. */
const CHECKSUMS = "SHA256SUMS";

/**
 * Every file served under a version: each binary, and the checksums. Each
 * is a route of its own, so any other name is not found before anything is
 * read, and a git path such as `/releases/info/refs` (a project named
 * `releases`) still reaches the gateway.
 */
const servedFiles: readonly string[] = [
  ...releaseTargets.map((target) => `${Brand.slug}-${target}`),
  CHECKSUMS,
];

/** The version segment that names whichever release is newest. */
const LATEST = "latest";

/** How long a versioned file may be kept: it never changes. */
const FOREVER = "public, max-age=31536000, immutable";

/** How long a reply that changes with the next release may be kept. */
const BRIEFLY = "public, max-age=300";

/** Neither a reply about a missing or broken release nor a 405 is kept. */
const NO_STORE = "no-store";

const notFound = HttpServerResponse.empty({
  headers: { "cache-control": NO_STORE },
  status: 404,
});

const unavailable = HttpServerResponse.empty({
  headers: { "cache-control": NO_STORE },
  status: 503,
});

/** Releases are only read here: W7 715 uploads them with Wrangler. */
const readOnly = HttpServerResponse.empty({
  headers: { allow: "GET, HEAD", "cache-control": NO_STORE },
  status: 405,
});

/** Nothing has been released: there is no manifest. */
class NoReleases extends Data.TaggedError("NoReleases") {}

/** The manifest could not be read, or did not decode. */
class ManifestUnusable extends Data.TaggedError("ManifestUnusable") {}

const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(ReleaseManifest)
);

/** A stored file's bytes as text. */
const textOf = ({ body }: ReleaseFile) =>
  Effect.tryPromise({
    catch: () => new ManifestUnusable(),
    try: () => new Response(body).text(),
  });

/** The manifest, decoded at the boundary (principle 2), and its text as stored. */
const manifestIn = (store: ReleaseStore["Service"]) =>
  Effect.gen(function* () {
    const stored = yield* store.get(MANIFEST_KEY);

    if (Option.isNone(stored)) {
      return yield* new NoReleases();
    }

    const text = yield* textOf(stored.value);

    const manifest = yield* decodeManifest(text).pipe(
      Effect.mapError(() => new ManifestUnusable())
    );

    return { manifest, text };
  });

/** A stored file as a reply, with `headers`. */
const fileReply = (
  file: ReleaseFile,
  contentType: string,
  headers: Readonly<Record<string, string>>
) =>
  HttpServerResponse.raw(file.body, {
    contentLength: file.size,
    contentType,
    headers,
  });

/** `/install.sh`: the latest release's install script. */
const installScript = (store: ReleaseStore["Service"]) =>
  Effect.gen(function* () {
    const { manifest } = yield* manifestIn(store);

    const file = yield* store.get(`releases/${manifest.latest}/install.sh`);

    return Option.match(file, {
      onNone: () => notFound,
      onSome: (script) =>
        fileReply(script, "text/x-shellscript; charset=utf-8", {
          "cache-control": BRIEFLY,
        }),
    });
  });

/**
 * Whether an `If-None-Match` header names the entity tag `tag`: as `*`, or
 * in its list, strong or weak (RFC 9110 §13.1.2 compares weakly).
 */
const holds = (header: string | undefined, tag: string) =>
  header !== undefined &&
  header
    .split(",")
    .map((each) => each.trim())
    .some((each) => each === "*" || each.replace(/^W\//u, "") === tag);

/**
 * A version's checksum file, made from its manifest entry: one line per
 * file, as `sha256sum` prints it, and none for a `SHA256SUMS` the manifest
 * lists, since this file is never that one.
 */
const checksumsOf = (assets: Release["assets"]) =>
  Array.sortWith(
    Object.entries(assets).filter(([name]) => name !== CHECKSUMS),
    ([name]) => name,
    Order.String
  )
    .map(([name, { sha256 }]) => `${sha256}  ${name}\n`)
    .join("");

/**
 * A binary of one version, kept forever and tagged with the digest its
 * manifest lists, or 304 to a client that already holds those bytes.
 */
const binaryReply = (
  store: ReleaseStore["Service"],
  request: HttpServerRequest.HttpServerRequest,
  key: string,
  { sha256 }: Asset
) =>
  Effect.gen(function* () {
    const headers = { "cache-control": FOREVER, etag: `"${sha256}"` };

    if (holds(request.headers["if-none-match"], headers.etag)) {
      return HttpServerResponse.empty({ headers, status: 304 });
    }

    const file = yield* store.get(key);

    return Option.match(file, {
      onNone: () => notFound,
      onSome: (binary) =>
        fileReply(binary, "application/octet-stream", headers),
    });
  });

/**
 * `/releases/:version/<asset>`: a binary or the checksum file of a version
 * the manifest lists, or a short-lived redirect from `latest` to the newest
 * one.
 */
const versioned = (
  store: ReleaseStore["Service"],
  request: HttpServerRequest.HttpServerRequest,
  asset: string
) =>
  Effect.gen(function* () {
    const { version = "" } = yield* HttpRouter.params;

    const { manifest } = yield* manifestIn(store);

    const named = version === LATEST ? manifest.latest : version;

    const release = Record.get(manifest.versions, named);

    if (Option.isNone(release)) {
      return notFound;
    }

    const { assets } = release.value;

    // The checksums are made for every listed version; a binary is served
    // only where the version lists it.
    const listed =
      asset === CHECKSUMS ? Option.none() : Record.get(assets, asset);

    if (asset !== CHECKSUMS && Option.isNone(listed)) {
      return notFound;
    }

    if (version === LATEST) {
      return HttpServerResponse.redirect(`/releases/${named}/${asset}`, {
        headers: { "cache-control": BRIEFLY },
      });
    }

    return yield* Option.match(listed, {
      onNone: () =>
        Effect.succeed(
          HttpServerResponse.text(checksumsOf(assets), {
            contentType: "text/plain; charset=utf-8",
            headers: { "cache-control": FOREVER },
          })
        ),
      onSome: (file) =>
        binaryReply(store, request, `releases/${named}/${asset}`, file),
    });
  });

/** `/releases/manifest.json`: the manifest as stored, once it decodes. */
const manifestReply = (store: ReleaseStore["Service"]) =>
  Effect.map(manifestIn(store), ({ text }) =>
    HttpServerResponse.text(text, {
      contentType: "application/json",
      headers: { "cache-control": BRIEFLY },
    })
  );

/**
 * `reply` for GET and HEAD (the router serves HEAD as GET, without the
 * body), and 405 for any other method; a release that failed to load is
 * not found when there is none yet, and unavailable when its manifest is
 * broken.
 */
const download = <R>(
  reply: (
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    NoReleases | ManifestUnusable,
    R
  >
) =>
  Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return readOnly;
    }

    return yield* reply(request).pipe(
      Effect.catchTags({
        ManifestUnusable: () => Effect.succeed(unavailable),
        NoReleases: () => Effect.succeed(notFound),
      })
    );
  });

/**
 * GET and HEAD `/install.sh`, `/releases/manifest.json` and
 * `/releases/:version/<asset>` for each served file.
 */
export const releaseRoutes: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | ReleaseStore
> = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const store = yield* ReleaseStore;

    yield* router.addAll([
      HttpRouter.route(
        "*",
        "/install.sh",
        download(() => installScript(store))
      ),
      HttpRouter.route(
        "*",
        MANIFEST_PATH,
        download(() => manifestReply(store))
      ),
      ...servedFiles.map((asset) =>
        HttpRouter.route(
          "*",
          `/releases/:version/${asset}`,
          download((request) => versioned(store, request, asset))
        )
      ),
    ]);
  })
);
