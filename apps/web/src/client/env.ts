/**
 * A project's env shape (the data pattern in `src/surfaces.ts`): `envShape`
 * over the browser's `/rpc`. It changes when a value is set (a ledger
 * entry, `ValueSet`) and when a landing changes the `.env.schema` (the
 * project's key), so both keys make it read again. The env page seeds it
 * with what its loader read on the server. (Lint keeps "shape" out of code
 * names, so the atom is named for the schema it reads.)
 */
import type { ProjectName } from "@repo/protocol/ids";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const envSchemaAtom = (project: ProjectName) =>
  ContractsClient.query(
    "envShape",
    { project },
    { reactivityKeys: [...keys.ledger(project), ...keys.project(project)] }
  );
