import type { RepoHost, RepoNotFound } from "@repo/artifacts/repo-host";
import type { FileView, Rev } from "@repo/protocol/domain/code";
import { BlobSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { Effect, Option } from "effect";

import type { CodeProject } from "../code.ts";
import { contentsOf, contentsOfBytes, keepContents, unlessTooLarge } from "./blob.ts";
import type { Contents } from "./blob.ts";
import { versionAt } from "./file-walk.ts";
import { keptOnlyIfCanonical } from "./history.ts";
import {
  blobKept,
  fileKept,
  fileKey,
  keepObject,
  objectKey,
  throughStore,
} from "./objects.ts";

export {
  contentsOf,
  contentsOfBytes,
  isBinary,
  TEXT_CAP,
  unlessTooLarge,
} from "./blob.ts";

export type { Contents } from "./blob.ts";

import { commitAt, resolveAt } from "./revision.ts";
import type { Resolved } from "./revision.ts";
import { entryAt } from "./tree.ts";

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

interface Whole {
  readonly blob: BlobSha;
  readonly contents: Contents;
}

/**
 * The file in one host call, kept as the blob its path names at the commit
 * and that blob's contents, each by its id: a kept file is read from the
 * store alone. ASSUMPTION: Artifacts' `readFile` gives a symlink's own blob,
 * as the tree does, rather than following it.
 */
const wholeAt = (
  repo: RepoName,
  commit: CommitSha,
  path: RepoPath
): Effect.Effect<Option.Option<Whole>, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const key = yield* fileKey(repo, commit, path);

    const named = yield* throughStore(fileKept, key, Effect.succeedNone);

    if (Option.isSome(named)) {
      const kept = yield* contentsOf(repo, named.value.blob);

      if (Option.isSome(kept)) {
        return Option.some({ blob: named.value.blob, contents: kept.value });
      }
    }

    const read = yield* unlessTooLarge(
      versionAt(repo, commit, path),
      Option.none
    );

    if (Option.isNone(read)) {
      return Option.none();
    }

    const { blob, bytes } = read.value;
    const contents = contentsOfBytes(bytes);

    yield* keepObject(fileKept, key, { blob });
    yield* keepObject(blobKept, objectKey(blobKept, repo, blob), contents, {
      heavy: true,
      keep: keepContents,
    });

    return Option.some({ blob, contents });
  });

const fileAtCommit = (
  { commit, repo }: Resolved,
  path: RepoPath
): Effect.Effect<FileView, UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const whole = yield* wholeAt(repo, commit, path).pipe(Effect.orDie);

    if (Option.isSome(whole)) {
      return viewOf(commit, path, whole.value.blob, whole.value.contents);
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

export const fileView = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath
): Effect.Effect<FileView, UnknownRevision | UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const resolved = yield* resolveAt(project, at);

    return yield* keptOnlyIfCanonical(resolved, fileAtCommit(resolved, path));
  });

