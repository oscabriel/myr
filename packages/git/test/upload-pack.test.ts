import { describe, expect, it } from "@effect/vitest";
import { CommitSha } from "@repo/protocol/ids";
import { Option } from "effect";

import { concat, FLUSH, pkt, utf8 } from "../src/pkt-line.ts";
import { readUpload } from "../src/upload-pack.ts";
import type { UploadRequest } from "../src/upload-pack.ts";

const first = "1".repeat(40);

const second = "2".repeat(40);

const DELIM = utf8("0001");

const request = (...parts: readonly (string | Uint8Array)[]) =>
  concat(
    parts.map((part) =>
      part instanceof Uint8Array ? part : pkt(utf8(`${part}\n`))
    )
  );

const reads = (want?: string): UploadRequest => ({
  reads: true,
  want: want === undefined ? Option.none() : Option.some(CommitSha.make(want)),
});

const rows: readonly {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly read: UploadRequest;
}[] = [
  {
    bytes: request(
      `want ${first} multi_ack_detailed side-band-64k ofs-delta agent=git/2.56.0`,
      `want ${second}`,
      FLUSH,
      "done"
    ),
    name: "a v0 clone reads, naming its first want, capabilities and all",
    read: reads(first),
  },
  {
    bytes: request(
      "command=fetch",
      "agent=git/2.56.0",
      "object-format=sha1",
      DELIM,
      "thin-pack",
      "ofs-delta",
      `want ${first}`,
      `want ${second}`,
      "done",
      FLUSH
    ),
    name: "a v2 fetch reads, naming its first want past the delimiter",
    read: reads(first),
  },
  {
    bytes: request(
      "command=ls-refs",
      "agent=git/2.56.0",
      DELIM,
      "peel",
      "symrefs",
      "ref-prefix HEAD",
      FLUSH
    ),
    name: "a v2 ls-refs lists refs and reads nothing",
    read: { reads: false, want: Option.none() },
  },
  {
    bytes: request(
      "command=fetch",
      DELIM,
      "want-ref refs/heads/main",
      "done",
      FLUSH
    ),
    name: "a fetch that wants a ref by name reads, naming no commit",
    read: reads(),
  },
  {
    bytes: request("want 1234abcd", "done"),
    name: "a want that is no full commit id names none",
    read: reads(),
  },
  {
    bytes: concat([utf8("zz07want"), request(`want ${first}`)]),
    name: "framing it can't read is still a read, naming nothing past the break",
    read: reads(),
  },
  {
    bytes: concat([
      request(`want ${first}`),
      utf8("zz07want"),
      request(`want ${second}`),
    ]),
    name: "lines before the framing breaks still count",
    read: reads(first),
  },
  {
    bytes: concat([
      request("command=fetch"),
      utf8("0003"),
      request(`want ${first}`),
    ]),
    name: "a length of 3 is no packet: nothing past it is read",
    read: reads(),
  },
  {
    bytes: new Uint8Array(),
    name: "an empty request is still a read",
    read: reads(),
  },
];

describe("an upload-pack request, as the read log reads it", () => {
  it.each(rows)("$name", ({ bytes, read }) => {
    expect(readUpload(bytes)).toStrictEqual(read);
  });
});
