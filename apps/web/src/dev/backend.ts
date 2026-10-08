/**
 * `#backend` under the `development` condition (`vite dev`, vitest): the
 * contracts served in process by the dev world, so the web runs with no
 * platform, no Artifacts and no network. The browser reaches it through
 * the same `/rpc` route, the same `Contracts` group and the same atoms as
 * production; only this target differs.
 *
 * One world per isolate (`server.ts`): it is made and seeded when this
 * module loads, since `toWebHandler` builds at once, and kept for the
 * isolate's life. Nothing outside `src/dev/` imports this file, and the
 * production build carries none of it (505's production-bundle test).
 */
import type { Backend } from "../server/rpc.ts";
import { devServer } from "./server.ts";

const served = devServer();

/** The development backend: every request answered by the dev world, the env unused. */
export const backend: Backend = (request) => served.handler(request);
