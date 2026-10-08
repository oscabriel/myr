import { describe, expect, it } from "@effect/vitest";
import type { Change } from "@repo/git/tree-diff";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import {
  LayerContentInPublicTree,
  PrivatePathInPublicTree,
} from "@repo/protocol/refusal";
import { Option } from "effect";

import { privatePaths, writeDown } from "../src/guards.ts";

const blob = (digit: string) => BlobSha.make(digit.repeat(40));

const path = (at: string) => RepoPath.make(at);

const added = (at: string, after: BlobSha): Change => ({
  after,
  path: path(at),
  status: "added",
});

const sealed = "checks/held-back/export/x.test.ts";

const layerPaths: ReadonlySet<RepoPath> = new Set([
  path(sealed),
  path("checks/held-back/parser/y.test.ts"),
]);

const push: readonly Change[] = [
  added("src/a.ts", blob("1")),
  added(sealed, blob("2")),
];

const pathsOf = (refusal: Option.Option<{ readonly paths: unknown }>) =>
  Option.map(refusal, ({ paths }) => paths);

describe("the private-path guard", () => {
  it("refuses a push that adds a path from a layer's path set", () => {
    expect(
      privatePaths({ changes: push, layerPaths, pusherCanRead: true })
    ).toStrictEqual(
      Option.some(new PrivatePathInPublicTree({ paths: [path(sealed)] }))
    );
  });

  // OSR §2.5, §5.4: the refusal names no layer path to someone who cannot
  // read the layer. It names every path they added or modified, all of them
  // their own, so which one collides stays unsaid.
  it("names every path a non-reader added or modified, not the colliding ones", () => {
    const changes: readonly Change[] = [
      ...push,
      {
        after: blob("4"),
        before: blob("3"),
        path: path("README.md"),
        status: "modified",
      },
      { before: blob("5"), path: path("docs/old.md"), status: "deleted" },
    ];

    expect(
      pathsOf(privatePaths({ changes, layerPaths, pusherCanRead: false }))
    ).toStrictEqual(Option.some(["README.md", sealed, "src/a.ts"]));
  });

  it("names exactly the colliding paths to a reader of the layer", () => {
    expect(
      pathsOf(privatePaths({ changes: push, layerPaths, pusherCanRead: true }))
    ).toStrictEqual(Option.some([sealed]));
  });

  it("refuses a modified file at a layer path", () => {
    const changes: readonly Change[] = [
      {
        after: blob("2"),
        before: blob("1"),
        path: path(sealed),
        status: "modified",
      },
    ];

    expect(
      pathsOf(privatePaths({ changes, layerPaths, pusherCanRead: true }))
    ).toStrictEqual(Option.some([sealed]));
  });

  it("lets through changes outside every layer's path set", () => {
    const changes: readonly Change[] = [
      added("src/a.ts", blob("1")),
      added("checks/held-back/export/x.test.ts.bak", blob("2")),
      added("checks/held-back/export", blob("3")),
    ];

    expect(
      privatePaths({ changes, layerPaths, pusherCanRead: false })
    ).toStrictEqual(Option.none());
    expect(
      privatePaths({ changes, layerPaths, pusherCanRead: true })
    ).toStrictEqual(Option.none());
  });

  it("never refuses a deletion", () => {
    const changes: readonly Change[] = [
      { before: blob("1"), path: path(sealed), status: "deleted" },
    ];

    expect(
      privatePaths({ changes, layerPaths, pusherCanRead: false })
    ).toStrictEqual(Option.none());
  });

  // A layer may name a folder in its path set: whatever sits under it is its.
  it("refuses a path under a folder in a layer's path set", () => {
    const changes: readonly Change[] = [added(sealed, blob("2"))];

    expect(
      pathsOf(
        privatePaths({
          changes,
          layerPaths: new Set([path("checks/held-back")]),
          pusherCanRead: true,
        })
      )
    ).toStrictEqual(Option.some([sealed]));
  });

  it("is total over empty inputs", () => {
    expect(
      privatePaths({ changes: [], layerPaths, pusherCanRead: false })
    ).toStrictEqual(Option.none());
    expect(
      privatePaths({
        changes: push,
        layerPaths: new Set(),
        pusherCanRead: false,
      })
    ).toStrictEqual(Option.none());
  });

  it("names paths sorted and once, whatever the order of the changes", () => {
    const changes: readonly Change[] = [
      added("z.ts", blob("1")),
      added(sealed, blob("2")),
      added("a.ts", blob("3")),
      added("z.ts", blob("1")),
    ];

    const reversed = changes.toReversed();

    expect(
      pathsOf(privatePaths({ changes, layerPaths, pusherCanRead: false }))
    ).toStrictEqual(Option.some(["a.ts", sealed, "z.ts"]));
    expect(
      privatePaths({ changes: reversed, layerPaths, pusherCanRead: false })
    ).toStrictEqual(
      privatePaths({ changes, layerPaths, pusherCanRead: false })
    );
  });
});

describe("the write-down guard", () => {
  const layerBlobs: ReadonlySet<BlobSha> = new Set([blob("a"), blob("b")]);

  const copied: readonly Change[] = [
    added("src/a.ts", blob("1")),
    added("test/export.test.ts", blob("a")),
  ];

  it("refuses an added blob the layer holds, for a reader of the layer", () => {
    expect(
      writeDown({ changes: copied, layerBlobs, readerCanReadLayer: true })
    ).toStrictEqual(
      Option.some(
        new LayerContentInPublicTree({
          paths: [path("test/export.test.ts")],
        })
      )
    );
  });

  // OSR §5.4: on someone who cannot read the layer it would be an oracle
  // for the layer's content, so it never runs.
  it("never refuses someone who cannot read the layer, even on an exact match", () => {
    expect(
      writeDown({ changes: copied, layerBlobs, readerCanReadLayer: false })
    ).toStrictEqual(Option.none());
  });

  it("counts a modified file whose new blob the layer holds as added", () => {
    const changes: readonly Change[] = [
      {
        after: blob("b"),
        before: blob("1"),
        path: path("test/parser.test.ts"),
        status: "modified",
      },
    ];

    expect(
      pathsOf(writeDown({ changes, layerBlobs, readerCanReadLayer: true }))
    ).toStrictEqual(Option.some(["test/parser.test.ts"]));
  });

  it("matches exact blob ids only, and never a deletion", () => {
    const changes: readonly Change[] = [
      added("src/near.ts", blob("c")),
      { before: blob("a"), path: path("test/gone.test.ts"), status: "deleted" },
      {
        after: blob("2"),
        before: blob("b"),
        path: path("test/rewritten.test.ts"),
        status: "modified",
      },
    ];

    expect(
      writeDown({ changes, layerBlobs, readerCanReadLayer: true })
    ).toStrictEqual(Option.none());
  });

  it("is total over empty inputs", () => {
    expect(
      writeDown({ changes: [], layerBlobs, readerCanReadLayer: true })
    ).toStrictEqual(Option.none());
    expect(
      writeDown({
        changes: copied,
        layerBlobs: new Set(),
        readerCanReadLayer: true,
      })
    ).toStrictEqual(Option.none());
  });

  it("names paths sorted and once, whatever the order of the changes", () => {
    const changes: readonly Change[] = [
      added("z/copy.test.ts", blob("a")),
      added("a/copy.test.ts", blob("b")),
      added("m/own.ts", blob("1")),
      added("z/copy.test.ts", blob("a")),
    ];

    expect(
      pathsOf(writeDown({ changes, layerBlobs, readerCanReadLayer: true }))
    ).toStrictEqual(Option.some(["a/copy.test.ts", "z/copy.test.ts"]));
    expect(
      writeDown({
        changes: changes.toReversed(),
        layerBlobs,
        readerCanReadLayer: true,
      })
    ).toStrictEqual(
      writeDown({ changes, layerBlobs, readerCanReadLayer: true })
    );
  });
});
