/**
 * Credentials for a run where nobody has logged in: no profile, for any
 * host. `login` and `logout` are in the command tree, so `program` needs
 * `Credentials`; a test that writes a profile through this layer is wrong,
 * and the mock's unimplemented `put` and `remove` die and say so.
 */
import { Effect, Layer } from "effect";

import { Credentials } from "../src/credentials.ts";

export const SignedOut = Layer.mock(Credentials)({
  current: Effect.succeedNone,
  forHost: () => Effect.succeedNone,
});
