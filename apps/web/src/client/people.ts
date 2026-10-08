/**
 * A person's page's read: their credit by project, area and
 * role. Read once per page; it renders as waiting on the server, and the
 * browser calls `/rpc` (see `front.ts`).
 */
import type { Handle } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";

export const creditsAtom = Atom.family((handle: Handle) =>
  Atom.withServerValueInitial(ContractsClient.query("credits", { handle }))
);
