/**
 * An ask's atoms (the data pattern in `src/surfaces.ts`): `showAsk` over the
 * browser's `/rpc`, keyed so that a write that changes the ask (a claim, a
 * landing) refetches it. The ask page seeds this atom with the data its
 * loader read on the server, so it fetches only when its keys change.
 */
import type { AskId, ProjectName } from "@repo/protocol/ids";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** The ask and its brief. */
export const askAtom = (project: ProjectName, ask: AskId) =>
  ContractsClient.query(
    "showAsk",
    { ask, project },
    { reactivityKeys: keys.ask(project, ask) }
  );
