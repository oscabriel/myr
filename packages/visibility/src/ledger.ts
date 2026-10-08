import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type {
  Layer,
  Ledger,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import type { ProjectName } from "@repo/protocol/ids";
import { Array, Option, Order } from "effect";
import type { DateTime } from "effect";

import { postureOf } from "./posture.ts";

const bySeq = Order.mapInput(Order.Number, (entry: LedgerEntry) => entry.seq);

const layersOf = (visibility: Option.Option<VisibilityPolicy>) =>
  Option.match(visibility, {
    onNone: (): readonly Layer[] => [],
    onSome: (policy) => policy.layers,
  });

/**
 * A project's public ledger: every row the Project DO keeps, in
 * sequence order (the sort is stable, so nothing is dropped or reordered
 * under one number), the layers its config declares, and the posture
 * computed from that config and its licence.
 */
export const ledgerOf = (input: {
  readonly project: ProjectName;
  readonly visibility: Option.Option<VisibilityPolicy>;
  readonly licence: Option.Option<string>;
  readonly rows: readonly LedgerEntry[];
}): Ledger => {
  const { label, posture } = postureOf(input);

  return {
    entries: Array.sort(input.rows, bySeq),
    layers: layersOf(input.visibility),
    posture,
    postureLabel: label,
    project: input.project,
  };
};

/** What the ledger records of a layer's declaration: what it holds and discloses. */
const declared = (layer: Layer) =>
  `${layer.disclose}:${Array.sort(layer.holds, Order.String).join(",")}`;

/**
 * The ledger entries a change to the visibility config writes, numbered
 * from `seq`: `LayerDeclared` for each layer the change adds, and again for
 * a layer whose kinds or disclosure it changes, sorted by layer name. A
 * layer that leaves writes nothing here; posture changes are decisions,
 * recorded where they are decided.
 */
export const entriesForPolicy = (
  before: Option.Option<VisibilityPolicy>,
  after: Option.Option<VisibilityPolicy>,
  seq: number,
  at: DateTime.Utc
): readonly LedgerEntry[] => {
  const was = new Map(
    layersOf(before).map((layer) => [layer.name, declared(layer)])
  );

  return Array.sort(
    layersOf(after).filter((layer) => was.get(layer.name) !== declared(layer)),
    Order.mapInput(Order.String, (layer: Layer) => layer.name)
  ).map((layer, index) =>
    LedgerEntry.cases.LayerDeclared.make({
      at,
      disclose: layer.disclose,
      kinds: layer.holds,
      layer: layer.name,
      seq: seq + index,
    })
  );
};
