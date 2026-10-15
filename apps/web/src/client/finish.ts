import type { Finish } from "@repo/protocol/contracts";
import type { Rev } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";
import { Atom, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** The newest commit on a fork's branch: what a finish would check. Read in the browser only. */
export const forkHeadAtom = Atom.family((project: ProjectName) =>
  Atom.family((at: Rev) =>
    Atom.withServerValueInitial(
      ContractsClient.query(
        "log",
        { at, limit: 1, project },
        { reactivityKeys: keys.project(project) }
      )
    )
  )
);

export const finishAtom = ContractsClient.runtime.fn<
  typeof Finish.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;

    return yield* client("finish", input).pipe(
      Reactivity.mutation([...keys.today(), ...keys.project(input.project)])
    );
  })
);
