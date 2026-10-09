/**
 * One file's contents as a reader sees them: its size, whether it is
 * binary (a NUL in its first 8 KiB, git's own test and `tree-diff.ts`'s),
 * and its text up to 1 MiB; past that, or when Artifacts answers that the
 * blob is too large to hold (`MEMORY_LIMIT`), it is truncated with no text.
 * Kept by the blob's id, unless its text is large.
 */
import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import type { FileView, Rev } from "@repo/protocol/domain/code";
import { BlobSha } from "@repo/protocol/ids";
import type { RepoName, RepoPath } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { Effect, Option, Schema } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { commitAt, resolveRev } from "./revision.ts";
import { entryAt } from "./tree.ts";

/** The most text a file's view carries: 1 MiB. */
export const TEXT_CAP = 1024 * 1024;

// git's own test: a NUL among the first bytes means the blob is not text.
const SNIFF = 8192;

/** The largest text a cache entry keeps; a larger one is read again. */
const KEPT_TEXT = 256 * 1024;

/** Whether `bytes` read as binary: a NUL among the first 8 KiB. */
export const isBinary = (bytes: Uint8Array) =>
  bytes.subarray(0, SNIFF).includes(0);

/** A file's contents: its text only when it is text and within the cap. */
export interface Contents {
  readonly size: number;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly text: Option.Option<string>;
}

/** What Artifacts throws when a blob is too large for the Worker to hold. */
const MemoryLimit = Schema.Struct({ code: Schema.Literal("MEMORY_LIMIT") });

const isMemoryLimit = Schema.is(MemoryLimit);

/**
 * `read`, or `tooLarge` when Artifacts said the blob was too large to hold:
 * its binding throws that as a defect, which here is an answer.
 */
export const unlessTooLarge = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  tooLarge: () => A
): Effect.Effect<A, E, R> =>
  Effect.catchDefect(read, (defect) =>
    isMemoryLimit(defect) ? Effect.succeed(tooLarge()) : Effect.die(defect)
  );

/** `bytes` as a reader sees them. */
export const contentsOfBytes = (bytes: Uint8Array): Contents => {
  const binary = isBinary(bytes);
  const truncated = !binary && bytes.length > TEXT_CAP;

  return {
    binary,
    size: bytes.length,
    text:
      binary || truncated
        ? Option.none()
        : Option.some(new TextDecoder().decode(bytes)),
    truncated,
  };
};

/**
 * The blob `blob`'s contents, kept by its id; none when the repo has no
 * blob by it (a submodule's commit).
 */
export const contentsOf = (
  repo: RepoName,
  blob: BlobSha
): Effect.Effect<Option.Option<Contents>, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;

    return yield* cache.through(
      `${repo}:text:${blob}`,
      unlessTooLarge(
        RepoHost.use((host) => host.readBlob(repo, ObjectId.make(blob))).pipe(
          Effect.map(Option.map(contentsOfBytes))
        ),
        () =>
          Option.some({
            binary: false,
            size: 0,
            text: Option.none(),
            truncated: true,
          })
      ),
      {
        heavy: true,
        keep: (contents) =>
          Option.match(contents, {
            onNone: () => false,
            onSome: ({ text }) =>
              Option.match(text, {
                onNone: () => true,
                onSome: (read) => read.length <= KEPT_TEXT,
              }),
          }),
      }
    );
  });

/** One file at `at`: its text, or that it is binary or too large. */
export const fileView = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath
): Effect.Effect<FileView, UnknownRevision | UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const commit = yield* resolveRev(project, at);

    const { tree } = yield* commitAt(project.repo, commit).pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.orDie
    );

    const entry = yield* entryAt(project.repo, tree, path).pipe(Effect.orDie);

    if (Option.isNone(entry) || entry.value.type !== "blob") {
      return yield* new UnknownPath({ commit, path });
    }

    const sha = BlobSha.make(entry.value.sha);

    const contents = yield* contentsOf(project.repo, sha).pipe(
      Effect.orDie,
      Effect.flatMap(Effect.fromOption),
      Effect.orDie
    );

    return {
      at: commit,
      binary: contents.binary,
      path,
      sha,
      size: contents.size,
      truncated: contents.truncated,
      ...Option.match(contents.text, {
        onNone: () => ({}),
        onSome: (text) => ({ text }),
      }),
    };
  });
