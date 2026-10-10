/**
 * Reactivity keys: a query names the keys it reads, and a mutation names the
 * keys it changes, so each write refetches exactly the reads it affects.
 *
 * Each key is one string: `Reactivity` treats every element of a key list
 * as a key of its own, so a bare `"project"` would match every project. An
 * ask's keys include its project's, so a write that changes the ask (a
 * claim, a landing) also refetches the project's ask list.
 */
import type { AskId, ProjectName, ProposalId } from "@repo/protocol/ids";

export const keys = {
  ask: (project: ProjectName, ask: AskId): readonly string[] => [
    `ask:${project}/${ask}`,
    `project:${project}`,
  ],
  /** The project's code reads (refs, trees, files, log, commits, why): a landing changes them. */
  code: (project: ProjectName): readonly string[] => [`code:${project}`],
  /**
   * The project's replayed events (`events.ts`): every event changes them.
   * Not the project's key, so a page's reads can be read again without
   * replaying every event once more.
   */
  events: (project: ProjectName): readonly string[] => [`events:${project}`],
  front: (): readonly string[] => ["front"],
  ledger: (project: ProjectName): readonly string[] => [`ledger:${project}`],
  /** The project's evaluated policy (the people page): a landing may change it. */
  policy: (project: ProjectName): readonly string[] => [`policy:${project}`],
  project: (project: ProjectName): readonly string[] => [`project:${project}`],
  /** One proposal (its draft state and files); includes its project's, as an ask's does. */
  proposal: (project: ProjectName, proposal: ProposalId): readonly string[] => [
    `proposal:${project}/${proposal}`,
    `project:${project}`,
  ],
  today: (): readonly string[] => ["today"],
};
