import type { EvidenceOf } from "@repo/protocol/contracts";
import { Effect } from "effect";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";

/**
 * A failed lane's log, read only when its reader asks, in the browser with
 * their own session: the answer page may be kept by the edge cache, so no log
 * is ever in its server read. One atom per log ref, so two lanes keep their own.
 */
export const evidenceAtom = Atom.family((_ref: string) =>
  ContractsClient.runtime.fn<typeof EvidenceOf.payloadSchema.Type>()(
    Effect.fnUntraced(function* (input) {
      const client = yield* ContractsClient;

      return yield* client("evidence", input);
    })
  )
);

export type Evidence = typeof EvidenceOf.successSchema.Type;
