import type { ProposeAsk } from "@repo/protocol/contracts";
import { RepoPath } from "@repo/protocol/ids";
import type { ProjectName, ProposalId } from "@repo/protocol/ids";
import { Array, Effect, Option, Order, Schema } from "effect";
import { AsyncResult, Atom, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

const decodePath = Schema.decodeUnknownOption(RepoPath);

export const topFolders = (paths: readonly RepoPath[]): readonly RepoPath[] => {
  const folders = paths.flatMap((path): readonly RepoPath[] => {
    const slash = path.indexOf("/");

    return slash <= 0 || path.startsWith(".")
      ? []
      : Option.toArray(decodePath(path.slice(0, slash)));
  });

  return Array.sort(Array.dedupe(folders), Order.String);
};

export const modulesAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.runtime.factory.withReactivity(keys.code(project))(
      ContractsClient.runtime.atom(
        Effect.gen(function* () {
          const client = yield* ContractsClient;
          const { paths } = yield* client("listPaths", { at: "main", project });

          return topFolders(paths);
        })
      )
    )
  )
);

// While a later send is on its way, or was refused, the atom still holds an earlier proposal; that names none here.
export const proposalMade = (
  result: AsyncResult.AsyncResult<typeof ProposeAsk.successSchema.Type, unknown>
): Option.Option<ProposalId> =>
  AsyncResult.isSuccess(result) && !result.waiting
    ? Option.some(result.value.proposal.id)
    : Option.none();

export const proposeAtom = ContractsClient.runtime.fn<
  typeof ProposeAsk.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;

    return yield* client("proposeAsk", input).pipe(
      Reactivity.mutation(keys.project(input.project))
    );
  })
);
