// `program` needs `Credentials`; the mock's unimplemented `put` and `remove`
// die, so a test that writes a profile fails.
import { Effect, Layer } from "effect";

import { Credentials } from "../src/credentials.ts";

export const SignedOut = Layer.mock(Credentials)({
  current: Effect.succeedNone,
  forHost: () => Effect.succeedNone,
});
