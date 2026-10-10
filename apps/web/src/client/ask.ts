/**
 * An ask's atoms (the data pattern in `src/surfaces.ts`): `showAsk` over the
 * browser's `/rpc`, keyed so that a write that changes the ask (a claim, a
 * landing) refetches it. The ask page seeds this atom with the data its
 * loader read on the server, so it fetches only when its keys change.
 */
import type { AskId, ProjectName } from "@repo/protocol/ids";
import { AsyncResult, Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** The ask and its brief. */
export const askAtom = (project: ProjectName, ask: AskId) =>
  ContractsClient.query(
    "showAsk",
    { ask, project },
    { reactivityKeys: keys.ask(project, ask) }
  );

// What an ask's atom holds: its read, under way, failed or done.
type AskRead = Atom.Type<ReturnType<typeof askAtom>>;

// No row selected: an ask never read.
const unselected: Atom.Atom<AskRead> = Atom.make<AskRead>(
  AsyncResult.initial()
);

// The selected ask in full, or nothing while no row is: one atom either
// way, so a list that reads it keeps its rows (and the row the keys rest
// on) when the selection moves.
export const selectedAskAtom = (
  pick: { readonly ask: AskId; readonly project: ProjectName } | undefined
): Atom.Atom<AskRead> =>
  pick === undefined ? unselected : askAtom(pick.project, pick.ask);
