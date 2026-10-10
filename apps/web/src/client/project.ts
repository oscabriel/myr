/**
 * A project page's reads: its open asks (`listAsks`), and the events of one
 * or more projects (`events.ts`) with their live views (`watch.ts`), as the
 * project's home and the front page's families read them. Each reads again
 * when its key is invalidated, which the page's live view does on each
 * event. Each renders as waiting on the server unless the page's loader
 * seeded it (`seeded.ts`); the browser calls `/rpc` (see `front.ts`).
 */
import type { ProjectEvent } from "@repo/protocol/domain/event";
import { ProjectName } from "@repo/protocol/ids";
import { AsyncResult, Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { projectEventsAtom } from "./events.ts";
import { keys } from "./keys.ts";
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

/** Projects named in one key, as the atoms below are keyed: "burrow vellum". */
export const projectsKey = (projects: readonly ProjectName[]) =>
  projects.toSorted().join(" ");

const projectsIn = (key: string): readonly ProjectName[] =>
  key === "" ? [] : key.split(" ").map((name) => ProjectName.make(name));

/**
 * The events of each project in `key`, as far as each has been read; a
 * project whose replay has not arrived is left out. A new value each time
 * a replay is read again.
 */
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

/**
 * The live view of each project in `key` (`watch.ts`): mounted by the
 * page in the browser, it reads each project's events again as they come.
 */
export const followedAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    for (const project of projectsIn(key)) {
      get.mount(watchAtom(project));
    }
  })
);

/**
 * The project's ledger, which its home reads for its posture and what it
 * holds back; read again when the ledger or the project changes. Waiting on
 * the server, where the page draws what its loader read.
 */
export const projectLedgerAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "ledger",
      { project },
      { reactivityKeys: [...keys.ledger(project), ...keys.project(project)] }
    )
  )
);

/**
 * The project's policy, which its home reads for who decides; read again
 * when a landing changes it. Waiting on the server, where the page draws
 * what its loader read.
 */
export const projectPolicyAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "projectPolicy",
      { project },
      { reactivityKeys: [...keys.policy(project), ...keys.project(project)] }
    )
  )
);
