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

export interface ReleaseFile {
  readonly body: ReadableStream | Uint8Array;
  readonly size: number;
}

export class ReleaseStore extends Context.Service<
  ReleaseStore,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<ReleaseFile>>;
  }
>()("platform/ReleaseStore") {}

const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

// Never `latest`, a `/` or a `..`.
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const FILE_NAME = /^[0-9A-Za-z][0-9A-Za-z._-]*$/u;

// Checked whole: a record with a refined key would drop a bad entry silently.
const keysMatch = (pattern: RegExp, what: string) =>
  Schema.makeFilter((record: Readonly<Record<string, unknown>>) =>
    Object.keys(record).every((key) => pattern.test(key))
      ? true
      : `every key is ${what}`
  );

const Asset = Schema.Struct({
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sha256: Sha256,
});

type Asset = typeof Asset.Type;

const Release = Schema.Struct({
  assets: Schema.Record(Schema.String, Asset).check(
    keysMatch(FILE_NAME, "a file name")
  ),
});

type Release = typeof Release.Type;

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

const releaseTargets = ["linux-x64", "darwin-arm64"] as const;

const MANIFEST_KEY = "releases/manifest.json";

const MANIFEST_PATH = `/${MANIFEST_KEY}`;

const CHECKSUMS = "SHA256SUMS";

// Each file is a route of its own, so any other name is not found before anything is
// read, and a git path such as `/releases/info/refs` still reaches the gateway.
const servedFiles: readonly string[] = [
  ...releaseTargets.map((target) => `${Brand.slug}-${target}`),
  CHECKSUMS,
];

const LATEST = "latest";

const FOREVER = "public, max-age=31536000, immutable";

const BRIEFLY = "public, max-age=300";

const NO_STORE = "no-store";

const notFound = HttpServerResponse.empty({
  headers: { "cache-control": NO_STORE },
  status: 404,
});

const unavailable = HttpServerResponse.empty({
  headers: { "cache-control": NO_STORE },
  status: 503,
});

const readOnly = HttpServerResponse.empty({
  headers: { allow: "GET, HEAD", "cache-control": NO_STORE },
  status: 405,
});

class NoReleases extends Data.TaggedError("NoReleases") {}

class ManifestUnusable extends Data.TaggedError("ManifestUnusable") {}

const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(ReleaseManifest)
);

const textOf = ({ body }: ReleaseFile) =>
  Effect.tryPromise({
    catch: () => new ManifestUnusable(),
    try: () => new Response(body).text(),
  });

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

// RFC 9110 §13.1.2: `If-None-Match` compares weakly.
const holds = (header: string | undefined, tag: string) =>
  header !== undefined &&
  header
    .split(",")
    .map((each) => each.trim())
    .some((each) => each === "*" || each.replace(/^W\//u, "") === tag);

const checksumsOf = (assets: Release["assets"]) =>
  Array.sortWith(
    Object.entries(assets).filter(([name]) => name !== CHECKSUMS),
    ([name]) => name,
    Order.String
  )
    .map(([name, { sha256 }]) => `${sha256}  ${name}\n`)
    .join("");

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

const manifestReply = (store: ReleaseStore["Service"]) =>
  Effect.map(manifestIn(store), ({ text }) =>
    HttpServerResponse.text(text, {
      contentType: "application/json",
      headers: { "cache-control": BRIEFLY },
    })
  );

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
