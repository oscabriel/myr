/**
 * smoke: `bun scripts/smoke.ts --stage dev-<user>|demo [--url <origin>]`.
 * Read-only probes against a live stage's platform; it fails loudly, naming
 * every probe that broke, and prints how long each took (the benches' input).
 * `infra/deploy.ts` runs it last (AGENTS.md principle 11).
 *
 * The stage's origin is `https://platform-<s>.<subdomain>.workers.dev`, with
 * the subdomain `bun run bootstrap` records in `infra/workers-dev.json`;
 * `--url` points it anywhere else. The probes live in `infra/smoke.ts`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Stdio } from "effect";

import { main } from "../infra/smoke.ts";

export { main, NoOrigin, probes, smoke, SmokeFailed } from "../infra/smoke.ts";

export type { SmokeReport } from "../infra/smoke.ts";

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* main(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
