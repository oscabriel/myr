import { describe, expect, it } from "@effect/vitest";

import { parseVouchFile } from "../src/vouch.ts";

// A vouch file in Ghostty's VOUCHED.td format: its header comment, then one
// handle per line.
const vouchedFile = [
  "# The list of vouched (or actively denounced) users for this repository.",
  "#",
  "# Syntax:",
  "#  - One handle per line (without @). Sorted alphabetically.",
  "",
  "00-kat",
  "alice",
  "github:carol",
  "-bob",
  "-github:mallory Refusing to follow the AI policy",
  "dave dave",
  "",
].join("\n");

describe(parseVouchFile, () => {
  it("reads one handle per line, skipping comments and blank lines", () => {
    expect(parseVouchFile(vouchedFile)).toStrictEqual({
      invalid: [],
      vouches: [
        { denounced: false, handle: "00-kat" },
        { denounced: false, handle: "alice" },
        { denounced: false, handle: "carol", platform: "github" },
        { denounced: true, handle: "bob" },
        {
          denounced: true,
          handle: "mallory",
          note: "Refusing to follow the AI policy",
          platform: "github",
        },
        { denounced: false, handle: "dave", note: "dave" },
      ],
    });
  });

  it("takes a leading + as an explicit vouch, with or without a space", () => {
    expect(parseVouchFile("+ erin\n+frank").vouches).toStrictEqual([
      { denounced: false, handle: "erin" },
      { denounced: false, handle: "frank" },
    ]);
  });

  it("reports a line whose handle is not a handle, by its line number", () => {
    expect(parseVouchFile("alice\n@bob\n-\ngithub:\n\n-_x note")).toStrictEqual(
      {
        invalid: [
          { line: 2, text: "@bob" },
          { line: 3, text: "-" },
          { line: 4, text: "github:" },
          { line: 6, text: "-_x note" },
        ],
        vouches: [{ denounced: false, handle: "alice" }],
      }
    );
  });

  it("reads Windows line endings and surrounding spaces", () => {
    expect(parseVouchFile("  alice  \r\n-bob\r\n")).toStrictEqual({
      invalid: [],
      vouches: [
        { denounced: false, handle: "alice" },
        { denounced: true, handle: "bob" },
      ],
    });
  });

  it("reads an empty file as no vouches", () => {
    expect(parseVouchFile("")).toStrictEqual({ invalid: [], vouches: [] });
  });
});
