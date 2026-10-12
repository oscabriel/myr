// The tokens are literal and exist only under the `development` condition, which the production build never resolves.
// Unlike the platform, the dev world does not refuse a credential an RPC message adds to its own headers.
import { authenticated } from "@repo/protocol/authenticate";
import type { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import type { Authenticated } from "@repo/protocol/principal";
import { Effect, Option } from "effect";
import type { Layer } from "effect";

import { devPeople } from "./seed.ts";

export const devToken = (handle: Handle) => `dev-${handle}`;

const tokens: ReadonlyMap<string, Handle> = new Map(
  devPeople.map((handle) => [devToken(handle), handle])
);

const personOf = (token: string) =>
  Option.map(Option.fromNullishOr(tokens.get(token)), (handle) =>
    Person.make({ handle })
  );

export const devSessions: Layer.Layer<Authenticated> = authenticated((token) =>
  Effect.succeed(personOf(token))
);
