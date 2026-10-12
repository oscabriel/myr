// Each atom waits on the server unless a loader seeded it: a server render never fetches into the registry every request shares.
import type { Reserve } from "@repo/protocol/domain/ask";
import type { KindName } from "@repo/protocol/ids";
import { Atom } from "effect/reactivity";

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
