// A request it can't make out still reads, with no commit named, so a read
// log built on it errs toward a read.
import { CommitSha } from "@repo/protocol/ids";
import { Array, Option, Schema } from "effect";

import { textLines } from "./pkt-line.ts";

export interface UploadRequest {
  readonly reads: boolean;
  readonly want: Option.Option<CommitSha>;
}

const WANT = /^want (?<oid>[0-9a-f]{40})(?: |$)/u;

const asCommit = Schema.decodeOption(CommitSha);

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
