import type { HeldBackResult } from "@repo/protocol/domain/answer";
import type { AreaName, BlobSha, RepoPath } from "@repo/protocol/ids";
import { SuiteRoot } from "@repo/protocol/ids";
import { Array, Effect, Option, Order } from "effect";

export interface SuiteFile {
  readonly path: RepoPath;
  readonly area: AreaName;
  readonly blob: BlobSha;
}

const LEAF_SEPARATOR = Uint8Array.of(0x00);

const NODE = Uint8Array.of(0x01);

const AREA = Uint8Array.of(0x02);

const utf8 = (text: string) => new TextEncoder().encode(text);

const sha256 = (...parts: readonly Uint8Array[]) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(parts.flatMap((part) => [...part]))
    )
  ).pipe(Effect.map((digest) => new Uint8Array(digest)));

const rootOf = (digest: Uint8Array) =>
  SuiteRoot.make(
    `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
  );

/**
 * The Merkle root of the nodes in order: pairs hashed as `H(0x01 ‖ left ‖
 * right)`, an odd one out promoted unchanged, level by level; one node is
 * its own root, and none is the hash of nothing.
 */
const merkle = (level: readonly Uint8Array[]): Effect.Effect<Uint8Array> =>
  Array.match(level, {
    onEmpty: () => sha256(),
    onNonEmpty: ([first, ...rest]) =>
      rest.length === 0
        ? Effect.succeed(first)
        : Effect.forEach(Array.chunksOf(level, 2), ([left, right]) =>
            right === undefined
              ? Effect.succeed(left)
              : sha256(NODE, left, right)
          ).pipe(Effect.flatMap(merkle)),
  });

const byPath = Order.combine(
  Order.mapInput(Order.String, (file: SuiteFile) => file.path),
  Order.mapInput(Order.String, (file: SuiteFile) => file.blob)
);

/** A file's leaf: `H(salt ‖ 0x00 ‖ path ‖ 0x00 ‖ blob id)`, the id as its 40 hex. */
const leaf = (salt: Uint8Array, file: SuiteFile) =>
  sha256(
    salt,
    LEAF_SEPARATOR,
    utf8(file.path),
    LEAF_SEPARATOR,
    utf8(file.blob)
  );

const roots = (salt: Uint8Array, files: readonly SuiteFile[]) =>
  Effect.forEach(
    Array.sort(new Set(files.map((file) => file.area)), Order.String),
    (area) =>
      Effect.forEach(
        Array.sort(
          files.filter((file) => file.area === area),
          byPath
        ),
        (file) => leaf(salt, file)
      ).pipe(
        Effect.flatMap(merkle),
        Effect.map((root) => [area, root] as const)
      )
  );

/** Without the salt, nobody can test a guess at a check against it. */
export const areaRoots = (
  salt: Uint8Array,
  files: readonly SuiteFile[]
): Effect.Effect<ReadonlyMap<AreaName, SuiteRoot>> =>
  roots(salt, files).pipe(
    Effect.map(
      (areas) => new Map(areas.map(([area, root]) => [area, rootOf(root)]))
    )
  );

/** `H(0x02 ‖ area ‖ 0x00 ‖ area root)` per area, sorted: the public sees the suite changed and learns nothing of what it holds. */
export const suiteRoot = (
  salt: Uint8Array,
  files: readonly SuiteFile[]
): Effect.Effect<SuiteRoot> =>
  roots(salt, files).pipe(
    Effect.flatMap((areas) =>
      Effect.forEach(areas, ([area, root]) =>
        sha256(AREA, utf8(area), LEAF_SEPARATOR, root)
      )
    ),
    Effect.flatMap(merkle),
    Effect.map(rootOf)
  );

const byArea = Order.combine(
  Order.mapInput(Order.String, (result: HeldBackResult) => result.area),
  Order.combine(
    Order.mapInput(Order.String, (result: HeldBackResult) => result.suite),
    Order.combine(
      Order.mapInput(Order.Number, (result: HeldBackResult) => result.passed),
      Order.mapInput(Order.Number, (result: HeldBackResult) => result.total)
    )
  )
);

export const heldBackValue = (input: {
  readonly results: readonly HeldBackResult[];
  readonly areas: readonly AreaName[];
}): Option.Option<string> => {
  const ran = new Set<AreaName>(input.results.map((result) => result.area));

  const lines = [
    ...Array.sort(input.results, byArea).map(
      ({ area, passed, suite, total }) =>
        [area, `${area} ${passed}/${total} @ ${suite}`] as const
    ),
    ...input.areas
      .filter((area) => !ran.has(area))
      .map((area) => [area, `${area} n/a`] as const),
  ];

  // The sort is stable, so one area's several results keep `byArea`'s order.
  return ran.size === 0
    ? Option.none()
    : Option.some(
        Array.dedupe(
          Array.sort(
            lines,
            Order.mapInput(
              Order.String,
              ([area]: (typeof lines)[number]) => area
            )
          ).map(([, line]) => line)
        ).join("; ")
      );
};

export const heldBackTrailer = (input: {
  readonly results: readonly HeldBackResult[];
  readonly areas: readonly AreaName[];
}): Option.Option<string> =>
  Option.map(heldBackValue(input), (value) => `Held-back: ${value}`);
