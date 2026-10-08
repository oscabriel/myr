/**
 * What a clone's or fetch's upload-pack request asks of a repo
 * (gitprotocol-pack, gitprotocol-v2), read from its pkt-lines for a log of
 * who read what: whether it reads content, and the first commit it wants.
 * Lines it can't make out still read, with no commit named, so a log built
 * on it errs toward a read.
 */
import { CommitSha } from "@repo/protocol/ids";
import { Array, Option, Schema } from "effect";

import { textLines } from "./pkt-line.ts";

/** What one upload-pack request reads of a repo. */
export interface UploadRequest {
  /** Anything but protocol v2's `ls-refs`, which lists refs and reads no content. */
  readonly reads: boolean;
  /** The first commit it wants, if a line names one. */
  readonly want: Option.Option<CommitSha>;
}

const WANT = /^want (?<oid>[0-9a-f]{40})(?: |$)/u;

const asCommit = Schema.decodeOption(CommitSha);

/** The request `bytes` hold, as git wrote it (inflated, if it was gzipped). */
export const readUpload = (bytes: Uint8Array): UploadRequest => {
  const lines = textLines(bytes);

  return {
    reads: lines[0] !== "command=ls-refs",
    want: Array.findFirst(lines, (line) =>
      Option.flatMap(
        Option.fromNullishOr(WANT.exec(line)?.groups?.oid),
        asCommit
      )
    ),
  };
};
