import type { Principal } from "@repo/protocol/principal";
import { Effect, Layer, Option } from "effect";

import { Sessions } from "../sessions.ts";

/** Sessions from a fixed table of tokens, for tests and local runs. */
export const MemorySessions = {
  layer: (tokens: Readonly<Record<string, Principal>>) => {
    const byToken = new Map(Object.entries(tokens));

    return Layer.succeed(
      Sessions,
      Sessions.of({
        verify: (token) =>
          Effect.succeed(Option.fromNullishOr(byToken.get(token))),
      })
    );
  },
};
