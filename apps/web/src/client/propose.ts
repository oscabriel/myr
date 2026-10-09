/**
 * The propose form's read and write. `modulesAtom` lists the territories
 * the form offers: the project's top folders at main, from `listPaths`
 * (dot folders, the config folder among them, are no territory). A project
 * with nothing landed yet refuses the read, and the form offers none.
 * `proposeAtom` sends `proposeAsk`; the project's proposals change, so its
 * key reads again.
 */
import type { ProposeAsk } from "@repo/protocol/contracts";
import { RepoPath } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Array, Effect, Option, Order, Schema } from "effect";
import { Atom, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

const decodePath = Schema.decodeUnknownOption(RepoPath);

/** The top folders among `paths`, sorted, without dot folders. */
export const topFolders = (paths: readonly RepoPath[]): readonly RepoPath[] => {
  const folders = paths.flatMap((path): readonly RepoPath[] => {
    const slash = path.indexOf("/");

    return slash <= 0 || path.startsWith(".")
      ? []
      : Option.toArray(decodePath(path.slice(0, slash)));
  });

  return Array.sort(Array.dedupe(folders), Order.String);
};

/** The project's top folders at main, each a territory the form offers. */
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

/** Propose an ask: `proposeAsk`'s payload, answered with the proposal. */
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
