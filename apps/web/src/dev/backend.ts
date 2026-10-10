/**
 * `#backend` under the `development` condition (`vite dev`, vitest): the
 * contracts served in process by the dev world, so the web runs with no
 * platform, no Artifacts and no network. The browser reaches it through
 * the same `/rpc` route, the same `Contracts` group and the same atoms as
 * production; only this target differs. The session cookie becomes the
 * bearer here too (`withCredential`), so the cookie `/auth/dev`
 * sets signs a browser in to the dev world as that person.
 *
 * One world per isolate (`server.ts`): it is made and seeded when this
 * module loads, since `toWebHandler` builds at once, and kept for the
 * isolate's life. Nothing outside `src/dev/` imports this file, and the
 * production build carries none of it (`test/production-bundle.test.ts`).
 */
import type { Backend } from "../server/rpc.ts";
import { credentialFrom, withCredential } from "../server/session.ts";
import { fixturesMode } from "./fixtures.ts";
import { devServer } from "./server.ts";

const served = devServer({ fixtures: fixturesMode });

/** The development backend: every request answered by the dev world, as the platform is asked; the env unused. */
export const backend: Backend = (request) =>
  served.handler(withCredential(request, credentialFrom(request)));
