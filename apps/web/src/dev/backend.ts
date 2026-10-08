/**
 * `#backend` under the `development` condition (`vite dev`, vitest). For now
 * it forwards like the production target; issue 502 replaces it with the
 * project service in process over memory adapters and a seeded world, so UI
 * work needs no live platform. Nothing outside `src/dev/` imports this file:
 * only the `#backend` condition reaches it, and the production build carries
 * none of it (505's production-bundle test).
 */
export { backend } from "../server/backend.ts";
