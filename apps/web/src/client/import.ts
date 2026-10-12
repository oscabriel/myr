import type { InitProject } from "@repo/protocol/contracts";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";
import { AsyncResult, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

// While a later import is on its way, or was refused, the atom still holds an earlier project; that names none here.
export const importMade = (
  result: AsyncResult.AsyncResult<
    typeof InitProject.successSchema.Type,
    unknown
  >
): Option.Option<ProjectName> =>
  AsyncResult.isSuccess(result) && !result.waiting
    ? Option.some(result.value.project)
    : Option.none();

export const importAtom = ContractsClient.runtime.fn<
  typeof InitProject.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;

    return yield* client("initProject", input).pipe(
      Reactivity.mutation([...keys.front(), ...keys.project(input.project)])
    );
  })
);
