/**
 * A walk over history that reads the file itself at each commit, one call
 * each, rather than the folders above it. A store answers one view a few
 * dozen calls a second, however many are under way (about 35 on
 * dev-oscabriel, repo reads and code store calls alike), and a path four
 * folders deep took two to three calls a commit by its folders: one root
 * tree each, and the folders above the path wherever they changed. Read
 * whole, the file is one call a commit, its git blob id is the SHA-1 of
 * its bytes, and each version's text is already at hand for the blame.
 *
 * Only a file at most `FILE_WALK_CAP` bytes at the walk's first commit is
 * walked this way, so a walk holds at most `READS_AT_ONCE` such files at
 * once; a larger file, a folder, a submodule or a missing path is looked
 * up by its folders (`tree.ts`). A commit where the path is not a file
 * (missing, or a folder then) reads as none, as a missing file does.
 */
import { RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import { BlobSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

/** The most a file may weigh at a walk's first commit to be read whole at each commit. */
export const FILE_WALK_CAP = 256 * 1024;

const encoder = new TextEncoder();

const hex = (digest: ArrayBuffer) =>
  [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** The git blob id of `bytes`: the SHA-1 of `blob <size>\0` and the bytes. */
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

/** The file at `path` in `commit`, read whole: none when no file is there. */
export const fileAt = (
  repo: RepoName,
  commit: CommitSha,
  path: RepoPath
): Effect.Effect<Option.Option<Uint8Array>, RepoNotFound, RepoHost> =>
  RepoHost.use((host) =>
    host.readFile(repo, Revision.Commit({ sha: commit }), path)
  );

/** A file read whole at a commit: its blob id and its bytes. */
export interface FileVersion {
  readonly blob: BlobSha;
  readonly bytes: Uint8Array;
}

/** The file's version at `path` in `commit`, read whole; none when no file is there. */
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

/**
 * The file at `path` in `commit` as a version, when a walk may read it
 * whole at each commit: a file of at most `FILE_WALK_CAP` bytes. None
 * means the walk looks the path up by its folders instead.
 */
export const walkableAt = (
  repo: RepoName,
  commit: CommitSha,
  path: RepoPath
): Effect.Effect<Option.Option<FileVersion>, RepoNotFound, RepoHost> =>
  Effect.map(
    versionAt(repo, commit, path),
    Option.filter(({ bytes }) => bytes.byteLength <= FILE_WALK_CAP)
  );
