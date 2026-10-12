import type { Handle } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";

export const creditsAtom = Atom.family((handle: Handle) =>
  Atom.withServerValueInitial(ContractsClient.query("credits", { handle }))
);
