import { layerPathRefusal } from "@repo/gate/stages/shape";
import type { Change } from "@repo/git/tree-diff";
import type { BlobSha, RepoPath } from "@repo/protocol/ids";
import { LayerContentInPublicTree } from "@repo/protocol/refusal";
import type { PrivatePathInPublicTree } from "@repo/protocol/refusal";
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

/**
 * Stage 1's no-write-down guard by path, as the gate owns
 * it (`@repo/gate/stages/shape`'s `layerPathRefusal`), so the landing guard
 * and stage 1 hold one rule: the answer's public tree may hold no path from
 * any layer's path set, a path or a folder above it. A deletion never
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
export const privatePaths: (input: {
  readonly changes: readonly Change[];
  readonly layerPaths: ReadonlySet<RepoPath>;
  readonly pusherCanRead: boolean;
}) => Option.Option<PrivatePathInPublicTree> = layerPathRefusal;

/**
 * The write-down guard by content (exact match only): a file the
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
