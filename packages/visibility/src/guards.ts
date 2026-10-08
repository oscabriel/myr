import type { Change } from "@repo/git/tree-diff";
import type { BlobSha, RepoPath } from "@repo/protocol/ids";
import {
  LayerContentInPublicTree,
  PrivatePathInPublicTree,
} from "@repo/protocol/refusal";
import { Array, Option, Order } from "effect";

/** The paths, once each and sorted, or none when there are none. */
const named = (paths: readonly RepoPath[]) =>
  Array.match(Array.dedupe(Array.sort(paths, Order.String)), {
    onEmpty: Option.none,
    onNonEmpty: Option.some,
  });

/** Files the answer puts into the public tree: added, or modified to a new blob. */
const written = (changes: readonly Change[]) =>
  changes.filter((change) => change.status !== "deleted");

/** A path in the set, or under a folder the set names. */
const inSet = (layerPaths: ReadonlySet<RepoPath>) => {
  const listed: ReadonlySet<string> = layerPaths;

  return (path: RepoPath) => {
    const parts = path.split("/");

    return parts.some((_, end) =>
      listed.has(parts.slice(0, end + 1).join("/"))
    );
  };
};

/**
 * Stage 1's no-write-down guard by path (OSR §2.5, §5.4): the answer's
 * public tree may hold no path from any layer's path set. A deletion never
 * triggers. The refusal is no oracle on which paths are layer paths: to a
 * pusher who cannot read the layer it names every path they added or
 * modified, all of them their own; only a reader hears exactly which ones
 * collide.
 *
 * `pusherCanRead` vouches for every layer whose paths are in `layerPaths`.
 * Paired with the paths of several layers, it is true only when the pusher
 * reads all of them: reading one layer must not name another's paths. Call
 * it once per layer, or with the union and `false`, when they read some.
 */
export const privatePaths = (input: {
  readonly changes: readonly Change[];
  readonly layerPaths: ReadonlySet<RepoPath>;
  readonly pusherCanRead: boolean;
}): Option.Option<PrivatePathInPublicTree> => {
  const own = written(input.changes).map((change) => change.path);
  const colliding = own.filter(inSet(input.layerPaths));

  return Option.flatMap(named(colliding), (exact) =>
    Option.map(
      input.pusherCanRead ? Option.some(exact) : named(own),
      (paths) => new PrivatePathInPublicTree({ paths })
    )
  );
};

/**
 * The write-down guard by content (OSR §5.4, exact match only): a file the
 * answer adds, or modifies to a new blob, whose git blob id is a blob of the
 * layer. It runs only for someone who can read the layer, the only people
 * who could have copied from it; on anyone else it would be an oracle for
 * the layer's content, so it says nothing.
 *
 * `layerBlobs` holds the blobs of layers the answerer reads, and only
 * those: a blob of a layer they cannot read would make this the oracle it
 * refuses to be.
 */
export const writeDown = (input: {
  readonly changes: readonly Change[];
  readonly layerBlobs: ReadonlySet<BlobSha>;
  readonly readerCanReadLayer: boolean;
}): Option.Option<LayerContentInPublicTree> =>
  input.readerCanReadLayer
    ? Option.map(
        named(
          written(input.changes)
            .filter(
              ({ after }) => after !== undefined && input.layerBlobs.has(after)
            )
            .map((change) => change.path)
        ),
        (paths) => new LayerContentInPublicTree({ paths })
      )
    : Option.none();
