/**
 * A project's raw bytes, `GET /<project>/raw/<rev>/<path…>` (spec W9-D6),
 * as one pure response both the platform (`apps/platform/src/raw.ts`) and
 * the web's dev world serve. Both origins hold a session cookie, so no file
 * may run as script there: every answer carries `nosniff` and a sandboxing
 * CSP, images come back as themselves (an SVG too: an `<img>` never runs
 * its script, and opened on its own the sandbox gives it no script and an
 * opaque origin), markup and every other text as plain text, and anything
 * else binary as bytes to save. A file at a commit's id never changes, so
 * it is cached for good; at a name that moves, for a minute. Anything that
 * is not a file at a revision is a 404 that says nothing of the repo.
 */
import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import { Rev } from "@repo/protocol/domain/code";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { codeProjectOf } from "../code.ts";
import type { CodeProject } from "../code.ts";
import { Projects } from "../projects.ts";
import { isBinary, unlessTooLarge } from "./file.ts";
import { commitAt, isFullSha, resolveRev } from "./revision.ts";
import { entryAt, segmentsOf } from "./tree.ts";

/** What a raw answer may load and do: nothing but its own images and inline styles, sandboxed. */
const SANDBOX =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

const IMAGES = new Map([
  ["avif", "image/avif"],
  ["gif", "image/gif"],
  ["ico", "image/x-icon"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["webp", "image/webp"],
]);

const TEXT = "text/plain; charset=utf-8";

/** What every raw answer carries, a refusal too (spec W9-D6). */
const SAFE = {
  "content-security-policy": SANDBOX,
  "x-content-type-options": "nosniff",
} as const;

/** `path`'s extension, lowercased; none without one. */
const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/**
 * The headers a raw answer for the blob `blob` at `path` carries: its type
 * by extension (an image as itself, anything else as plain text, or as
 * bytes when `binary`), `nosniff` and the sandbox, and a cache for good
 * when `rev` is a commit's id, for a minute when it is a name.
 */
export const rawHeaders = (
  path: RepoPath,
  rev: "sha" | "ref",
  blob: BlobSha,
  binary = false
): Headers => {
  const headers = new Headers({
    ...SAFE,
    "content-type":
      IMAGES.get(extensionOf(path)) ??
      (binary ? "application/octet-stream" : TEXT),
  });

  if (rev === "sha") {
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("etag", `"${blob}"`);
  } else {
    headers.set("cache-control", "public, max-age=60");
  }

  return headers;
};

/** A 404 that says nothing of the repo. */
const notFound = () => new Response(null, { headers: SAFE, status: 404 });

/** A 413: Artifacts said the blob is too large to hold. */
const tooLarge = () => new Response(null, { headers: SAFE, status: 413 });

/** The file `path` at `rev` of the project's canonical repo, as raw bytes. */
export const rawOf = (
  project: CodeProject,
  rev: Rev,
  path: RepoPath
): Effect.Effect<Response, never, RepoHost> =>
  Effect.gen(function* () {
    const commit = yield* resolveRev(project, Option.some(rev));

    const { tree } = yield* commitAt(project.repo, commit).pipe(
      Effect.flatMap(Effect.fromOption)
    );

    const entry = yield* entryAt(project.repo, tree, path);

    if (Option.isNone(entry) || entry.value.type !== "blob") {
      return notFound();
    }

    const blob = BlobSha.make(entry.value.sha);

    const bytes = yield* RepoHost.use((host) =>
      host.readBlob(project.repo, ObjectId.make(blob))
    );

    return Option.match(bytes, {
      onNone: notFound,
      onSome: (read) =>
        new Response(new Uint8Array(read), {
          headers: rawHeaders(
            path,
            isFullSha(rev) ? "sha" : "ref",
            blob,
            isBinary(read)
          ),
          status: 200,
        }),
    });
  }).pipe(
    (read) => unlessTooLarge(read, tooLarge),
    Effect.catchTags({
      NoSuchElementError: () => Effect.succeed(notFound()),
      RepoNotFound: () => Effect.succeed(notFound()),
      UnknownRevision: () => Effect.succeed(notFound()),
    })
  );

const decodeRev = Schema.decodeUnknownOption(Rev);

const decodePath = Schema.decodeUnknownOption(RepoPath);

const decoded = Option.liftThrowable(decodeURIComponent);

/**
 * A raw request's revision and path from everything after `raw/`, as the
 * URL carries it: the first segment is the revision (a tag's `/` arrives
 * as `%2F`), the rest the file's path, each decoded once. A path with an
 * empty, `.` or `..` segment, before or after decoding, is none.
 */
export const rawRequestOf = (
  rest: string
): Option.Option<{ readonly rev: Rev; readonly path: RepoPath }> => {
  const slash = rest.indexOf("/");

  if (slash === -1) {
    return Option.none();
  }

  return Option.all({
    path: decoded(rest.slice(slash + 1)).pipe(
      Option.filter((path) => Option.isSome(segmentsOf(path))),
      Option.flatMap(decodePath)
    ),
    rev: Option.flatMap(decoded(rest.slice(0, slash)), decodeRev),
  });
};

/**
 * Everything after `/<project>/raw/` in a request's URL (whole, or its path
 * and query), still encoded. Read from the URL itself, not a router's
 * parameter: a router decodes `%2F`, which would cut a tag's name
 * (`%40datekit%2Fcore%402.0.0`) in two.
 */
export const rawRestOf = (url: string): string =>
  new URL(url, "http://raw.invalid").pathname.split("/").slice(3).join("/");

/**
 * The answer to `GET /<project>/raw/<rest>` at `url` (whole, or its path
 * and query): the project found by its name, then its file. A project
 * never made is a 404 too.
 */
export const rawFor = (
  project: ProjectName,
  url: string
): Effect.Effect<Response, never, RepoHost | Projects> =>
  Option.match(rawRequestOf(rawRestOf(url)), {
    onNone: () => Effect.succeed(notFound()),
    onSome: ({ path, rev }) =>
      Projects.use((projects) => projects.get(project)).pipe(
        Effect.flatMap((api) => rawOf(codeProjectOf(api, project), rev, path)),
        Effect.catchTag("UnknownProject", () => Effect.succeed(notFound()))
      ),
  });
