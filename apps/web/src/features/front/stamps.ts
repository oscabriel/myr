import type { ProjectEvent } from "@repo/protocol/domain/event";
import type { AskId } from "@repo/protocol/ids";
import { useState } from "react";

import { askStates, lastSeq, stampsFrom } from "../shared/ask-progress.ts";
import type { AskProgress } from "../shared/ask-progress.ts";

export interface StampMemory {
  readonly mountSeq: number;
  readonly previous: ReadonlyMap<AskId, AskProgress>;
  readonly stamped: ReadonlySet<AskId>;
}

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

export const useStamps = (
  reads: ReadonlyMap<string, readonly ProjectEvent[]>
): ((project: string) => ReadonlySet<AskId>) => {
  const [seen, setSeen] = useState(reads);
  const [memory, setMemory] = useState(() => stepAll(new Map(), reads));

  // Step the memory in this render, as React's guide to state from the previous
  // render does, so the stamp draws with the read.
  let current = memory;

  if (reads !== seen) {
    current = stepAll(memory, reads);
    setSeen(reads);
    setMemory(current);
  }

  return (project) => current.get(project)?.stamped ?? new Set<AskId>();
};
