/**
 * The front page's reads: the open asks across every project, and the list
 * of projects (which the shell's rail also reads, for each posture). The
 * page's loader reads the asks on the server and seeds their atom
 * (`seeded.ts`); the events of the projects whose families it draws are
 * `project.ts`'s.
 *
 * Each atom renders as waiting on the server unless a loader seeded it
 * (`withServerValueInitial`): a server render never fetches into the
 * registry that every request on the Worker shares.
 */
import type { Reserve } from "@repo/protocol/domain/ask";
import type { KindName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** The open asks `frontPage` returns for `filter`, as the anonymous viewer may take them until sign-in names one. */
export const frontPageAtom = Atom.family(
  (filter: { readonly kind?: KindName; readonly reserved?: Reserve }) =>
    Atom.withServerValueInitial(
      ContractsClient.query("frontPage", filter, {
        reactivityKeys: keys.front(),
      })
    )
);

/** Every project the platform lists, with its posture, open asks and last landing. */
export const projectsAtom = Atom.withServerValueInitial(
  ContractsClient.query("listProjects", {}, { reactivityKeys: keys.front() })
);
