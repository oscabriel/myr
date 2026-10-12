// Keyed by the project too: when the watch's stream fails at connect, its poll changes only the project's keys.
import type { ProjectName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const policyAtom = Atom.family((project: ProjectName) =>
  ContractsClient.query(
    "projectPolicy",
    { project },
    { reactivityKeys: [...keys.policy(project), ...keys.project(project)] }
  )
);
