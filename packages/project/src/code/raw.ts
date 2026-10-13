import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import { Rev } from "@repo/protocol/domain/code";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { codeProjectOf } from "../code.ts";
import type { CodeProject } from "../code.ts";
import { Projects } from "../projects.ts";
import { isBinary, unlessTooLarge } from "./file.ts";
import { commitAt, isFullSha, resolveAt } from "./revision.ts";
import { entryAt, segmentsOf } from "./tree.ts";

/** Both origins hold a session cookie, so no raw file may run as script: every answer, a refusal too, carries `nosniff` and this CSP. */
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

const SAFE = {
  "content-security-policy": SANDBOX,
  "x-content-type-options": "nosniff",
} as const;

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

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

const notFound = () => new Response(null, { headers: SAFE, status: 404 });

const tooLarge = () => new Response(null, { headers: SAFE, status: 413 });

export const rawOf = (
  project: CodeProject,
  rev: Rev,
  path: RepoPath
): Effect.Effect<Response, never, RepoHost> =>
  Effect.gen(function* () {
    const { commit, repo } = yield* resolveAt(project, Option.some(rev));

    const { tree } = yield* commitAt(repo, commit).pipe(
      Effect.flatMap(Effect.fromOption)
    );

    const entry = yield* entryAt(repo, tree, path);

    if (Option.isNone(entry) || entry.value.type !== "blob") {
      return notFound();
    }

    const blob = BlobSha.make(entry.value.sha);

    const bytes = yield* RepoHost.use((host) =>
      host.readBlob(repo, ObjectId.make(blob))
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

/** Read from the URL, not a router's parameter: a router decodes `%2F`, which would cut a tag's name in two. */
export const rawRestOf = (url: string, project: ProjectName): string => {
  const segments = new URL(url, "http://raw.invalid").pathname.split("/");
  const named = project.split("/").length;

  if (segments[named + 1] === "raw") {
    return segments.slice(named + 2).join("/");
  }

  return segments[2] === "raw" ? segments.slice(3).join("/") : "";
};

export const rawFor = (
  project: ProjectName,
  url: string
): Effect.Effect<Response, never, RepoHost | Projects> =>
  Option.match(rawRequestOf(rawRestOf(url, project)), {
    onNone: () => Effect.succeed(notFound()),
    onSome: ({ path, rev }) =>
      Projects.use((projects) => projects.get(project)).pipe(
        Effect.flatMap((api) => rawOf(codeProjectOf(api, project), rev, path)),
        Effect.catchTag("UnknownProject", () => Effect.succeed(notFound()))
      ),
  });
