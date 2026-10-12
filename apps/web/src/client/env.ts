// Lint keeps "shape" out of code names, so the atom is named for the schema it reads.
import type { ProjectName } from "@repo/protocol/ids";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const envSchemaAtom = (project: ProjectName) =>
  ContractsClient.query(
    "envShape",
    { project },
    { reactivityKeys: [...keys.ledger(project), ...keys.project(project)] }
  );
