import type { ProjectName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

const todayFamily = Atom.family((project: ProjectName | undefined) =>
  Atom.withServerValueInitial(
    ContractsClient.query("today", project === undefined ? {} : { project }, {
      reactivityKeys: keys.today(),
    })
  )
);

export const todayAtom = (project?: ProjectName) => todayFamily(project);
