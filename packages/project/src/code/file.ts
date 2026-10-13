import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import type { FileView, Rev } from "@repo/protocol/domain/code";
import { BlobSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { Effect, Option, Schema } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { versionAt } from "./file-walk.ts";
import { commitAt, resolveAt } from "./revision.ts";
import { entryAt } from "./tree.ts";

export const TEXT_CAP = 1024 * 1024;

// git's own test: a NUL among the first bytes means the blob is not text.
const SNIFF = 8192;

const KEPT_TEXT = 256 * 1024;

export const isBinary = (bytes: Uint8Array) =>
  bytes.subarray(0, SNIFF).includes(0);

export interface Contents {
  readonly size: number;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly text: Option.Option<string>;
}

const MemoryLimit = Schema.Struct({ code: Schema.Literal("MEMORY_LIMIT") });

const isMemoryLimit = Schema.is(MemoryLimit);

/** Artifacts' binding throws a too-large blob as a defect, which here is an answer. */
export const unlessTooLarge = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  tooLarge: () => A
): Effect.Effect<A, E, R> =>
  Effect.catchDefect(read, (defect) =>
    isMemoryLimit(defect) ? Effect.succeed(tooLarge()) : Effect.die(defect)
  );

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

const viewOf = (
  commit: CommitSha,
  path: RepoPath,
  sha: BlobSha,
  contents: Contents
): FileView => ({
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
});

/** ASSUMPTION: Artifacts' `readFile` gives a symlink's own blob, as the tree does, rather than following it. */
const wholeAt = (repo: RepoName, commit: CommitSha, path: RepoPath) =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;

    return yield* cache.through(
      `${repo}:file:${commit}:${path}`,
      unlessTooLarge(versionAt(repo, commit, path), Option.none),
      {
        heavy: true,
        keep: (read) =>
          Option.match(read, {
            onNone: () => false,
            onSome: ({ bytes }) => bytes.byteLength <= KEPT_TEXT,
          }),
      }
    );
  });

export const fileView = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath
): Effect.Effect<FileView, UnknownRevision | UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const { commit, repo } = yield* resolveAt(project, at);

    const whole = yield* wholeAt(repo, commit, path).pipe(Effect.orDie);

    if (Option.isSome(whole)) {
      return viewOf(
        commit,
        path,
        whole.value.blob,
        contentsOfBytes(whole.value.bytes)
      );
    }

    const { tree } = yield* commitAt(repo, commit).pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.orDie
    );

    const entry = yield* entryAt(repo, tree, path).pipe(Effect.orDie);

    if (Option.isNone(entry) || entry.value.type !== "blob") {
      return yield* new UnknownPath({ commit, path });
    }

    const sha = BlobSha.make(entry.value.sha);

    const contents = yield* contentsOf(repo, sha).pipe(
      Effect.orDie,
      Effect.flatMap(Effect.fromOption),
      Effect.orDie
    );

    return viewOf(commit, path, sha, contents);
  });
