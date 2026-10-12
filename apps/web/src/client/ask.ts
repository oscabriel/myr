import type { AskId, ProjectName } from "@repo/protocol/ids";
import { AsyncResult, Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export const askAtom = (project: ProjectName, ask: AskId) =>
  ContractsClient.query(
    "showAsk",
    { ask, project },
    { reactivityKeys: keys.ask(project, ask) }
  );

type AskRead = Atom.Type<ReturnType<typeof askAtom>>;

const unselected: Atom.Atom<AskRead> = Atom.make<AskRead>(
  AsyncResult.initial()
);

// One atom either way, so a list that reads it keeps its rows when the selection moves.
export const selectedAskAtom = (
  pick: { readonly ask: AskId; readonly project: ProjectName } | undefined
): Atom.Atom<AskRead> =>
  pick === undefined ? unselected : askAtom(pick.project, pick.ask);
