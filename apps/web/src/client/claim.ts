import type { Claim, Release } from "@repo/protocol/contracts";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";
import { AsyncResult, Atom, Reactivity } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

// The inbox reads the reader's claims under Today's key.
const touched = (input: {
  readonly ask: AskId;
  readonly project: ProjectName;
}) => [...keys.ask(input.project, input.ask), ...keys.today()];

export const claimAtom = ContractsClient.runtime.fn<
  typeof Claim.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;

    return yield* client("claim", input).pipe(
      Reactivity.mutation(touched(input))
    );
  })
);

export const releaseAtom = ContractsClient.runtime.fn<
  typeof Release.payloadSchema.Type
>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* ContractsClient;

    return yield* client("release", input).pipe(
      Reactivity.mutation(touched(input))
    );
  })
);

const myClaimsFamily = Atom.family((project: ProjectName) =>
  ContractsClient.query("status", { project }, { reactivityKeys: keys.today() })
);

type MyClaims = Atom.Type<ReturnType<typeof myClaimsFamily>>;

const unread: Atom.Atom<MyClaims> = Atom.make<MyClaims>(AsyncResult.initial());

/**
 * The reader's own claims in one project, each with the fork it pushes to;
 * read only for a project where the reader holds one, so no other page asks.
 */
export const myClaimsAtom = (project: ProjectName | undefined) =>
  project === undefined ? unread : myClaimsFamily(project);
