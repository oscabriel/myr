/**
 * Who calls the dev world: protocol's own `Authenticated` server side
 * (`authenticated`), the rule the platform serves by, over a table of dev
 * tokens. `dev-<handle>` names that person of the seed's fictional people;
 * any other credential names nobody, so the call is `Unauthenticated`; a
 * call with none is anyone, for a `public` contract only. The tokens are
 * literal and exist only under the `development` condition, which the
 * production build never resolves.
 *
 * The world reads the credential from the call's headers, which the RPC
 * server fills from the HTTP request's own, so a browser's `Authorization`
 * reaches it as it reaches the platform. (The platform also refuses one an
 * RPC message adds to its own headers; the dev world does not check.)
 */
import { authenticated } from "@repo/protocol/authenticate";
import type { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import type { Authenticated } from "@repo/protocol/principal";
import { Effect, Option } from "effect";
import type { Layer } from "effect";

import { devPeople } from "./seed.ts";

/** The dev token that signs in as `handle`. */
export const devToken = (handle: Handle) => `dev-${handle}`;

const tokens: ReadonlyMap<string, Handle> = new Map(
  devPeople.map((handle) => [devToken(handle), handle])
);

/** The person a dev token names, if it names one of the seed's people. */
const personOf = (token: string) =>
  Option.map(Option.fromNullishOr(tokens.get(token)), (handle) =>
    Person.make({ handle })
  );

export const devSessions: Layer.Layer<Authenticated> = authenticated((token) =>
  Effect.succeed(personOf(token))
);
