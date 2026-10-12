// A store answers a few dozen calls a second, and walking a path by its folders costs two to three calls a commit; reading a small file whole costs one.
import { RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import { BlobSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

export const FILE_WALK_CAP = 256 * 1024;

const encoder = new TextEncoder();

const hex = (digest: ArrayBuffer) =>
  [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const blobIdOf = (bytes: Uint8Array): Effect.Effect<BlobSha> =>
  Effect.gen(function* () {
    const header = encoder.encode(`blob ${bytes.byteLength}\0`);
    const raw = new Uint8Array(header.byteLength + bytes.byteLength);

    raw.set(header);
    raw.set(bytes, header.byteLength);

    const digest = yield* Effect.promise(() =>
      crypto.subtle.digest("SHA-1", raw)
    );

    return BlobSha.make(hex(digest));
  });

export const fileAt = (
  repo: RepoName,
  commit: CommitSha,
  path: RepoPath
): Effect.Effect<Option.Option<Uint8Array>, RepoNotFound, RepoHost> =>
  RepoHost.use((host) =>
    host.readFile(repo, Revision.Commit({ sha: commit }), path)
  );

export interface FileVersion {
  readonly blob: BlobSha;
  readonly bytes: Uint8Array;
}

export const versionAt = (
  repo: RepoName,
  commit: CommitSha,
  path: RepoPath
): Effect.Effect<Option.Option<FileVersion>, RepoNotFound, RepoHost> =>
  Effect.flatMap(fileAt(repo, commit, path), (read) =>
    Option.match(read, {
      onNone: () => Effect.succeedNone,
      onSome: (bytes) =>
        Effect.map(blobIdOf(bytes), (blob) => Option.some({ blob, bytes })),
    })
  );

export const walkableAt = (
  repo: RepoName,
  commit: CommitSha,
  path: RepoPath
): Effect.Effect<Option.Option<FileVersion>, RepoNotFound, RepoHost> =>
  Effect.map(
    versionAt(repo, commit, path),
    Option.filter(({ bytes }) => bytes.byteLength <= FILE_WALK_CAP)
  );
