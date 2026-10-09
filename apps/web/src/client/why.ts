/**
 * The "why" read (the data pattern in `src/surfaces.ts`): an atom over the
 * browser's `/rpc`, taking the contract's own payload and keyed by the
 * project's code (`keys.code`), which a landing changes. The page reads on
 * the server first (its loader); this atom is for a drawing that asks
 * again in the browser.
 */
import type { Contract } from "@repo/protocol/contracts";
import type { Rpc } from "effect/rpc";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** Why each line of a file at a revision is there. */
export const whyAtom = (
  payload: Rpc.Payload<Rpc.ExtractTag<Contract, "why">>
) =>
  ContractsClient.query("why", payload, {
    reactivityKeys: keys.code(payload.project),
  });
