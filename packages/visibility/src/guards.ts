import { layerPathRefusal } from "@repo/gate/stages/shape";
import type { Change } from "@repo/git/tree-diff";
import type { BlobSha, RepoPath } from "@repo/protocol/ids";
import { LayerContentInPublicTree } from "@repo/protocol/refusal";
import type { PrivatePathInPublicTree } from "@repo/protocol/refusal";
import { Array, Option, Order } from "effect";

const named = (paths: readonly RepoPath[]) =>
  Array.match(Array.dedupe(Array.sort(paths, Order.String)), {
    onEmpty: Option.none,
    onNonEmpty: Option.some,
  });

const written = (changes: readonly Change[]) =>
  changes.filter((change) => change.status !== "deleted");

/**
 * The same rule as stage 1 (`@repo/gate/stages/shape`'s `layerPathRefusal`).
 * The refusal is no oracle: to a pusher who cannot read the layer it names
 * every path they added or modified; only a reader hears which collide.
 * `pusherCanRead` must hold for every layer in `layerPaths`: call it once per
 * layer, or with the union and `false`, when they read some.
 */
export const privatePaths: (input: {
  readonly changes: readonly Change[];
  readonly layerPaths: ReadonlySet<RepoPath>;
  readonly pusherCanRead: boolean;
}) => Option.Option<PrivatePathInPublicTree> = layerPathRefusal;

/**
 * It runs only for someone who can read the layer, the only people who could
 * have copied from it; on anyone else it would be an oracle for the layer's
 * content. `layerBlobs` holds the blobs of layers the answerer reads, and only
 * those.
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
