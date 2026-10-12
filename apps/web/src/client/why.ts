import type { Contract } from "@repo/protocol/contracts";
import type { Rpc } from "effect/rpc";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const whyAtom = (
  payload: Rpc.Payload<Rpc.ExtractTag<Contract, "why">>
) =>
  ContractsClient.query("why", payload, {
    reactivityKeys: keys.code(payload.project),
  });
