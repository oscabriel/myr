import type {
  AskId,
  CommitSha,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

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

export const landingAtom = (project: ProjectName, sha: LandedSha) =>
  ContractsClient.query(
    "landing",
    { project, sha },
    { reactivityKeys: keys.project(project) }
  );
