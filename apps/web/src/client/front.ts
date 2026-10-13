// Each atom waits on the server unless a loader seeded it: a server render never fetches into the registry every request shares.
import { useAtomValue } from "@effect/atom-react";
import type { Reserve } from "@repo/protocol/domain/ask";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { KindName } from "@repo/protocol/ids";
import { Atom, AsyncResult } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const frontPageAtom = Atom.family(
  (filter: { readonly kind?: KindName; readonly reserved?: Reserve }) =>
    Atom.withServerValueInitial(
      ContractsClient.query("frontPage", filter, {
        reactivityKeys: keys.front(),
      })
    )
);

export const projectsAtom = Atom.withServerValueInitial(
  ContractsClient.query("listProjects", {}, { reactivityKeys: keys.front() })
);

/** Every project with its posture and open asks, read where it is shown, never by the shell on every page. */
export const useProjectList = (): readonly ProjectListing[] | undefined => {
  const listed = useAtomValue(projectsAtom);

  return AsyncResult.isSuccess(listed) ? listed.value.projects : undefined;
};
