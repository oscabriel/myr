/**
 * Which landings an open page stamps: a child of a family that lands while
 * the page is open settles with the stamp, once, and a landing the page's
 * first read already held never does.
 *
 * The first read the page settles on sets `mountSeq` (the highest event
 * number it held); each later read stamps the asks it shows landed that the
 * read before did not, closed by an event after `mountSeq`
 * (`stampsFrom`). Whether the stream or a poll brought the later read, a
 * landing stamps once: the stamped set only grows, so a mark keeps its
 * stamp through every later render rather than settling again.
 */
import type { ProjectEvent } from "@repo/protocol/domain/event";
import type { AskId } from "@repo/protocol/ids";
import { useState } from "react";

import { askStates, lastSeq, stampsFrom } from "../shared/ask-progress.ts";
import type { AskProgress } from "../shared/ask-progress.ts";

/** What a page remembers between reads of one project's events. */
export interface StampMemory {
  /** The highest event number of the first read. */
  readonly mountSeq: number;
  /** Where each ask stood in the read before. */
  readonly previous: ReadonlyMap<AskId, AskProgress>;
  /** Every ask stamped so far. */
  readonly stamped: ReadonlySet<AskId>;
}

/** The page's memory after one more read of `events`; the first read stamps nothing. */
export const stampStep = (
  memory: StampMemory | undefined,
  events: readonly ProjectEvent[]
): StampMemory => {
  const states = askStates(events);

  if (memory === undefined) {
    return { mountSeq: lastSeq(events), previous: states, stamped: new Set() };
  }

  const fresh = stampsFrom(memory.previous, states, memory.mountSeq);

  return {
    mountSeq: memory.mountSeq,
    previous: states,
    stamped:
      fresh.size === 0
        ? memory.stamped
        : new Set([...memory.stamped, ...fresh]),
  };
};

/** Each project's memory after one more read of each project's events. */
const stepAll = (
  memory: ReadonlyMap<string, StampMemory>,
  reads: ReadonlyMap<string, readonly ProjectEvent[]>
): ReadonlyMap<string, StampMemory> =>
  new Map(
    [...reads].map(([project, events]) => [
      project,
      stampStep(memory.get(project), events),
    ])
  );

/**
 * The asks each project's page should stamp, from its events as the page
 * reads them (a new map each time a read changes). A project's first read
 * stamps nothing.
 */
export const useStamps = (
  reads: ReadonlyMap<string, readonly ProjectEvent[]>
): ((project: string) => ReadonlySet<AskId>) => {
  const [seen, setSeen] = useState(reads);
  const [memory, setMemory] = useState(() => stepAll(new Map(), reads));

  // A new read: step the memory now, in this render, as React's guide to
  // state from the previous render does, so the stamp draws with the read.
  let current = memory;

  if (reads !== seen) {
    current = stepAll(memory, reads);
    setSeen(reads);
    setMemory(current);
  }

  return (project) => current.get(project)?.stamped ?? new Set<AskId>();
};
