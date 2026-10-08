/**
 * A project's ledger (the data pattern in `src/surfaces.ts`): `ledger` over
 * the browser's `/rpc`, keyed by the project's ledger, so each entry the
 * platform appends (`LedgerAppended`, which `watch.ts` turns into
 * `keys.ledger`) makes it read again. It is keyed by the project too: when
 * the watch's stream fails at connect, its poll changes only the project's
 * keys, and the ledger must read again then as well. The ledger page seeds
 * it with what its loader read on the server.
 */
import type { ProjectName } from "@repo/protocol/ids";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const ledgerAtom = (project: ProjectName) =>
  ContractsClient.query(
    "ledger",
    { project },
    { reactivityKeys: [...keys.ledger(project), ...keys.project(project)] }
  );
