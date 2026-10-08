/**
 * An answer's atoms (the data pattern in `src/surfaces.ts`): the verdict on
 * an ask's latest answer (or the one at `head`), and the landing a landed
 * answer made. A judged or landed answer changes its ask's keys, so both
 * refetch then. The answer page seeds them with the data its loader read
 * on the server.
 */
import type {
  AskId,
  CommitSha,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** The verdict on the ask's latest answer, or on the answer whose head is `head`. */
export const verdictAtom = (
  project: ProjectName,
  ask: AskId,
  head?: CommitSha
) =>
  ContractsClient.query(
    "verdict",
    head === undefined ? { ask, project } : { ask, head, project },
    { reactivityKeys: keys.ask(project, ask) }
  );

/** The landing at `sha`, with its credit trailers. */
export const landingAtom = (project: ProjectName, sha: LandedSha) =>
  ContractsClient.query(
    "landing",
    { project, sha },
    { reactivityKeys: keys.project(project) }
  );
