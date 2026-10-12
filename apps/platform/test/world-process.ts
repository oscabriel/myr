// Imports no Worker module, so a world process may import it statically and load
// the rest after `shimWorkers` has run.
import { Config, Effect, Schema } from "effect";

import * as shim from "./workers-shim.ts";

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
