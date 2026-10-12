// One world per isolate, made and seeded when this module loads, since `toWebHandler` builds at once.
// Nothing outside `src/dev/` imports this file, so the production build carries none of it.
import type { Backend } from "../server/rpc.ts";
import { credentialFrom, withCredential } from "../server/session.ts";
import { fixturesMode } from "./fixtures.ts";
import { devServer } from "./server.ts";

// vitest (`MODE` is `test`) keeps the calendar as written, so a test reads the same instants on every run.
const time = import.meta.env.MODE === "test" ? "fixed" : "present";

const served = devServer({ fixtures: fixturesMode, time });

export const backend: Backend = (request) =>
  served.handler(withCredential(request, credentialFrom(request)));
