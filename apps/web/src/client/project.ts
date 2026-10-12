import type { ProjectEvent } from "@repo/protocol/domain/event";
import { ProjectName } from "@repo/protocol/ids";
import { AsyncResult, Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { projectEventsAtom } from "./events.ts";
import { keys } from "./keys.ts";
import { ledgerAtom } from "./ledger.ts";
import { policyAtom } from "./policy.ts";
import { watchAtom } from "./watch.ts";

export const asksAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "listAsks",
      { project },
      { reactivityKeys: keys.project(project) }
    )
  )
);

export const projectsKey = (projects: readonly ProjectName[]) =>
  projects.toSorted().join(" ");

const projectsIn = (key: string): readonly ProjectName[] =>
  key === "" ? [] : key.split(" ").map((name) => ProjectName.make(name));

export const familyEventsAtom = Atom.family((key: string) =>
  Atom.make(
    (get): ReadonlyMap<ProjectName, readonly ProjectEvent[]> =>
      new Map(
        projectsIn(key).flatMap((project) => {
          const read = get(projectEventsAtom(project));

          return AsyncResult.isSuccess(read) ? [[project, read.value]] : [];
        })
      )
  )
);

export const followedAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    for (const project of projectsIn(key)) {
      get.mount(watchAtom(project));
    }
  })
);

export const projectLedgerAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(ledgerAtom(project))
);

export const projectPolicyAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(policyAtom(project))
);
