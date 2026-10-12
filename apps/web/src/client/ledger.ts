// Keyed by the project too: when the watch's stream fails at connect, its poll changes only the project's keys.
import type { ProjectName } from "@repo/protocol/ids";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const ledgerAtom = (project: ProjectName) =>
  ContractsClient.query(
    "ledger",
    { project },
    { reactivityKeys: [...keys.ledger(project), ...keys.project(project)] }
  );
