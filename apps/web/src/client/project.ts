/**
 * A project page's reads: its open asks (`listAsks`). Its recent landings
 * come from the project's events (`events.ts`), not a contract of their
 * own. Both read again when the project's key is invalidated, which the
 * page's live view (`watch.ts`) does on each event. Each renders as
 * waiting on the server, and the browser calls `/rpc` (see `front.ts`).
 */
import type { ProjectName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const asksAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "listAsks",
      { project },
      { reactivityKeys: keys.project(project) }
    )
  )
);
