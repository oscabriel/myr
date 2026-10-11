/**
 * The import form's write. `importAtom` sends `initProject` with `import`:
 * the platform clones the public repo and makes the project, with the
 * caller as its decider, which takes up to half a minute. The list of
 * projects changes, and so does the project's own key, so both read again.
 */
import type { InitProject } from "@repo/protocol/contracts";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";
import { AsyncResult, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/**
 * The project the last import made, once it answered. While a later
 * import is on its way, or after it was refused, the atom still holds an
 * earlier one's project, which names none here: the form never moves to it.
 */
export const importMade = (
  result: AsyncResult.AsyncResult<
    typeof InitProject.successSchema.Type,
    unknown
  >
): Option.Option<ProjectName> =>
  AsyncResult.isSuccess(result) && !result.waiting
    ? Option.some(result.value.project)
    : Option.none();

/** Import a public repo: `initProject`'s payload, answered with the project. */
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
