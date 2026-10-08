import { describe, expect, it } from "@effect/vitest";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import { AreaName, BlobSha, RepoPath, SuiteRoot } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import {
  areaRoots,
  heldBackTrailer,
  heldBackValue,
  suiteRoot,
} from "../src/commitment.ts";
import type { SuiteFile } from "../src/commitment.ts";

const salt = Uint8Array.from({ length: 32 }, (_, index) => index);

const exportArea = AreaName.make("export");

const parserArea = AreaName.make("parser");

const file = (path: string, area: AreaName, digit: string): SuiteFile => ({
  area,
  blob: BlobSha.make(digit.repeat(40)),
  path: RepoPath.make(path),
});

const a = file("checks/export/a.test.ts", exportArea, "1");

const b = file("checks/export/b.test.ts", exportArea, "2");

const c = file("checks/parser/c.test.ts", parserArea, "3");

const suite = [a, b, c];

// The construction, written out by hand with WebCrypto (OSR §5.4):
// leaf = H(salt ‖ 0x00 ‖ path ‖ 0x00 ‖ blob id), node = H(0x01 ‖ left ‖ right),
// an odd one out promoted; the suite joins each area's root under its name,
// H(0x02 ‖ area ‖ 0x00 ‖ area root), in the same tree, areas sorted.
const utf8 = (text: string) => new TextEncoder().encode(text);

const sha256 = (...parts: readonly Uint8Array[]) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(parts.flatMap((part) => [...part]))
    )
  ).pipe(Effect.map((digest) => new Uint8Array(digest)));

const leaf = ({ blob, path }: SuiteFile) =>
  sha256(salt, Uint8Array.of(0), utf8(path), Uint8Array.of(0), utf8(blob));

const node = (left: Uint8Array, right: Uint8Array) =>
  sha256(Uint8Array.of(1), left, right);

const named = (area: string, root: Uint8Array) =>
  sha256(Uint8Array.of(2), utf8(area), Uint8Array.of(0), root);

const hex = (bytes: Uint8Array) =>
  `sha256:${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

// The same vectors from Python's hashlib, an implementation of its own.
const vectors = {
  exportRoot:
    "sha256:cda4db168b5b2967a1560c909b01dcfc04ae78f7b556d634b32d1a9ebb9de04e",
  oneAreaRoot:
    "sha256:86f9b2ca4a764792d4dfbfbe347813a8c03555b057332256298ff8e6c0ab4695",
  oneAreaSuite:
    "sha256:06c8e5cd215d629e4fb0245f5ac7a4929fd2075261d1ae94d31a6dafafcf17af",
  parserRoot:
    "sha256:c601cb4e3ac341f25fe476b8ff09fc88dbf325ad70f91326a879c5e58ef8ae56",
  suite:
    "sha256:7f06a303c5990bd14625987bf96771c7f89573a135636e32c765447f169f51ba",
};

describe("a held-back suite's commitment", () => {
  it.effect("matches known-answer vectors for a three-file suite", () =>
    Effect.gen(function* () {
      const exportRoot = yield* node(yield* leaf(a), yield* leaf(b));
      const parserRoot = yield* leaf(c);

      const byHand = yield* node(
        yield* named("export", exportRoot),
        yield* named("parser", parserRoot)
      );

      expect(hex(exportRoot)).toBe(vectors.exportRoot);
      expect(hex(parserRoot)).toBe(vectors.parserRoot);
      expect(hex(byHand)).toBe(vectors.suite);

      expect(yield* suiteRoot(salt, suite)).toBe(vectors.suite);
      expect(yield* areaRoots(salt, suite)).toStrictEqual(
        new Map([
          [exportArea, vectors.exportRoot],
          [parserArea, vectors.parserRoot],
        ])
      );
    })
  );

  it.effect("promotes the odd leaf in an area of three", () =>
    Effect.gen(function* () {
      const moved = { ...c, area: exportArea };

      const root = yield* node(
        yield* node(yield* leaf(a), yield* leaf(b)),
        yield* leaf(moved)
      );

      expect(hex(root)).toBe(vectors.oneAreaRoot);
      expect(hex(yield* named("export", root))).toBe(vectors.oneAreaSuite);

      expect(yield* areaRoots(salt, [a, b, moved])).toStrictEqual(
        new Map([[exportArea, vectors.oneAreaRoot]])
      );
      expect(yield* suiteRoot(salt, [a, b, moved])).toBe(vectors.oneAreaSuite);
    })
  );

  it.effect("is the same for the same salt and files, in any order", () =>
    Effect.gen(function* () {
      const root = yield* suiteRoot(salt, suite);

      for (const order of [
        [a, b, c],
        [c, b, a],
        [b, c, a],
        [c, a, b],
      ]) {
        expect(yield* suiteRoot(salt, order)).toBe(root);
        expect(yield* areaRoots(salt, order)).toStrictEqual(
          yield* areaRoots(salt, suite)
        );
      }

      expect(Schema.is(SuiteRoot)(root)).toBeTruthy();
    })
  );

  it.effect(
    "changes when any file's content, path or area changes, or the salt does",
    () =>
      Effect.gen(function* () {
        const root = yield* suiteRoot(salt, suite);

        const changed = [
          [a, b, { ...c, blob: BlobSha.make("4".repeat(40)) }],
          [a, b, { ...c, path: RepoPath.make("checks/parser/d.test.ts") }],
          [a, b, { ...c, area: AreaName.make("format") }],
          [a, { ...b, area: parserArea }, c],
          [a, b],
        ];

        for (const files of changed) {
          expect(yield* suiteRoot(salt, files)).not.toBe(root);
        }

        const salted = salt.toReversed();

        expect(yield* suiteRoot(salted, suite)).not.toBe(root);
      })
  );

  it.effect("roots each area in that area's leaves alone", () =>
    Effect.gen(function* () {
      const roots = yield* areaRoots(salt, suite);
      const exportOnly = yield* areaRoots(salt, [b, a]);

      expect(roots.get(exportArea)).toBe(exportOnly.get(exportArea));
      expect(roots.get(parserArea)).toBe(
        (yield* areaRoots(salt, [c])).get(parserArea)
      );
    })
  );

  it.effect("roots an empty suite in the hash of nothing", () =>
    Effect.gen(function* () {
      expect(yield* suiteRoot(salt, [])).toBe(
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
      expect(yield* areaRoots(salt, [])).toStrictEqual(new Map());
    })
  );
});

const root = (digit: string) => SuiteRoot.make(`sha256:${digit.repeat(64)}`);

const result = (
  area: AreaName,
  passed: number,
  total: number,
  commitment = root("3")
): HeldBackResult => ({ area, passed, suite: commitment, total });

describe("the Held-back trailer", () => {
  it("names each area's result and its root, and n/a for an area with no checks in this run", () => {
    expect(
      heldBackTrailer({
        areas: [parserArea, exportArea],
        results: [result(exportArea, 7, 7)],
      })
    ).toStrictEqual(
      Option.some(
        `Held-back: export 7/7 @ sha256:${"3".repeat(64)}; parser n/a`
      )
    );
  });

  it("is the value alone for the trailer machinery, without its key", () => {
    expect(
      heldBackValue({
        areas: [exportArea, parserArea],
        results: [result(exportArea, 7, 7)],
      })
    ).toStrictEqual(
      Option.some(`export 7/7 @ sha256:${"3".repeat(64)}; parser n/a`)
    );
  });

  it("sorts the areas, whatever order they ran or were declared in", () => {
    const format = AreaName.make("format");

    const expected = Option.some(
      [
        `Held-back: export 2/3 @ sha256:${"1".repeat(64)}`,
        "format n/a",
        `parser 1/1 @ sha256:${"2".repeat(64)}`,
      ].join("; ")
    );

    expect(
      heldBackTrailer({
        areas: [parserArea, format, exportArea],
        results: [
          result(parserArea, 1, 1, root("2")),
          result(exportArea, 2, 3, root("1")),
        ],
      })
    ).toStrictEqual(expected);
    expect(
      heldBackTrailer({
        areas: [exportArea, parserArea, format],
        results: [
          result(exportArea, 2, 3, root("1")),
          result(parserArea, 1, 1, root("2")),
        ],
      })
    ).toStrictEqual(expected);
  });

  it("names an area that ran even when it is not declared", () => {
    expect(
      heldBackTrailer({ areas: [], results: [result(exportArea, 1, 2)] })
    ).toStrictEqual(
      Option.some(`Held-back: export 1/2 @ sha256:${"3".repeat(64)}`)
    );
  });

  it("is none when no area ran", () => {
    expect(
      heldBackTrailer({ areas: [exportArea, parserArea], results: [] })
    ).toStrictEqual(Option.none());
    expect(heldBackTrailer({ areas: [], results: [] })).toStrictEqual(
      Option.none()
    );
  });
});
