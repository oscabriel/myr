/**
 * What a test world run as a process of its own needs before it builds the
 * world (`serve-world.ts`, and the visibility cartridge's
 * `visibility/serve-cartridge-world.ts`): `cloudflare:workers` served from
 * the shim, since the Worker's modules import it and the process loads them
 * after, as vitest's alias does for the platform's tests; and the people
 * `WORLD_SESSIONS` names.
 *
 * This module imports no Worker module, so a world process may import it
 * statically and load the rest after `shimWorkers` has run.
 */
import { Config, Effect, Schema } from "effect";

import * as shim from "./workers-shim.ts";

/** Bun's runtime plugins, as far as this file uses them (the platform has no Bun types). */
interface BunPlugins {
  readonly plugin: (plugin: {
    readonly name: string;
    readonly setup: (build: {
      readonly module: (
        specifier: string,
        load: () => {
          readonly exports: typeof shim;
          readonly loader: "object";
        }
      ) => void;
    }) => void;
  }) => void;
}

declare const Bun: BunPlugins;

/** `cloudflare:workers` served from the shim, for every module loaded after. */
export const shimWorkers = Effect.sync(() => {
  Bun.plugin({
    name: "cloudflare-workers-shim",
    setup: (build) => {
      build.module("cloudflare:workers", () => ({
        exports: { ...shim },
        loader: "object",
      }));
    },
  });
});

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
);

/**
 * The people who may call beside dora, alice and bob: `WORLD_SESSIONS`, a
 * JSON object from token to handle (as `SESSION_TOKENS` is); none when it
 * is unset.
 */
export const worldSessions = Effect.gen(function* () {
  const raw = yield* Config.String("WORLD_SESSIONS").pipe(
    Config.withDefault("{}")
  );

  return yield* decodeSessions(raw).pipe(
    Effect.catch(() =>
      Effect.die("WORLD_SESSIONS is not a JSON object from token to handle")
    )
  );
});
