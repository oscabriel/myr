/**
 * Reactivity keys: a query names the keys it reads, and a mutation names the
 * keys it changes, so each write refetches exactly the reads it affects.
 *
 * Each key is one string: `Reactivity` treats every element of a key list
 * as a key of its own, so a bare `"project"` would match every project. An
 * ask's keys include its project's, so a write that changes the ask (a
 * claim, a landing) also refetches the project's ask list.
 */
import type { AskId, ProjectName } from "@repo/protocol/ids";

export const keys = {
  ask: (project: ProjectName, ask: AskId): readonly string[] => [
    `ask:${project}/${ask}`,
    `project:${project}`,
  ],
  front: (): readonly string[] => ["front"],
  ledger: (project: ProjectName): readonly string[] => [`ledger:${project}`],
  project: (project: ProjectName): readonly string[] => [`project:${project}`],
  today: (): readonly string[] => ["today"],
};
