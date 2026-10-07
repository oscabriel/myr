import type { Handle } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Effect, Layer, Option } from "effect";

import { Sessions } from "../sessions.ts";

/** Sessions over a fixed table of tokens to handles. */
const service = (tokens: Readonly<Record<string, Handle>>) => {
  const byToken = new Map(Object.entries(tokens));

  return Sessions.of({
    verify: (token) =>
      Effect.succeed(
        Option.map(Option.fromNullishOr(byToken.get(token)), (handle) =>
          Person.make({ handle })
        )
      ),
  });
};

/**
 * Sessions from a fixed table of tokens to handles, for tests and local
 * runs: as a layer, or as the service itself, to combine with others
 * (`firstOf`).
 */
export const MemorySessions = {
  layer: (tokens: Readonly<Record<string, Handle>>) =>
    Layer.succeed(Sessions, service(tokens)),
  service,
};
