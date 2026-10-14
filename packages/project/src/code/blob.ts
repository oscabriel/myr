/** A blob's contents by its id, kept in the isolate and the store while its text is under the cap. */
import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import type { BlobSha, RepoName } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { blobKept, objectKey, throughStore } from "./objects.ts";

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

/** Kept by its id, in the isolate and the store, while its text is under the cap. */
export const keepContents = ({ text }: Contents) =>
  Option.match(text, {
    onNone: () => true,
    onSome: (read) => read.length <= KEPT_TEXT,
  });

export const contentsOf = (
  repo: RepoName,
  blob: BlobSha
): Effect.Effect<Option.Option<Contents>, RepoNotFound, RepoHost> =>
  throughStore(
    blobKept,
    objectKey(blobKept, repo, blob),
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
    { heavy: true, keep: keepContents }
  );
