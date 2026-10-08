/**
 * The visibility cartridge's env, as the platform provides it (W6 614):
 * the project service's `ProjectEnv` over an `.env.schema` parser and the
 * vault that seals write-only values under the stage's `MASTER_KEY` (610's
 * WebCrypto envelope). It reads each project's schemas at the landed SHA
 * through the platform's `RepoHost`, the public namespace's.
 *
 * The parser is the one part the Worker does not carry yet: 603's adapter
 * over `@env-spec/parser` adds 44,410 bytes to the platform's entry, which
 * then measures 1,696,434 of `bytes:check`'s 1,665,000. Until it runs off
 * the entry (614's Comments), the Worker's parser reads no schema, so a
 * project's env shape is empty there, as without the cartridge; `envOn`
 * takes the real adapter wherever a host can carry it (the platform's
 * Node tests do).
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { ProjectEnvLive } from "@repo/project/visibility/env";
import {
  EnvSchemaParser,
  EnvSchemaUnreadable,
} from "@repo/visibility/env-schema";
import { WriteOnlyValuesWebCrypto } from "@repo/visibility/vault/webcrypto";
import { Effect, Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";

/**
 * A parser that reads no schema: each is unreadable, so the env shape has
 * no items, no value can be set, and every check runs with the env it
 * would have without the cartridge. Nothing is guessed from the text.
 */
export const EnvSchemaParserOffEntry: Layer.Layer<EnvSchemaParser> =
  Layer.succeed(EnvSchemaParser, {
    parse: (file) =>
      Effect.fail(
        new EnvSchemaUnreadable({
          file,
          reason: "the platform does not carry the env-schema parser yet",
        })
      ),
  });

/** The project service's env for one stage's config, with `parser` reading the schemas. */
export const envOn = (
  config: PlatformConfig,
  parser: Layer.Layer<EnvSchemaParser>
): Layer.Layer<never, never, RepoHost> =>
  ProjectEnvLive.pipe(
    Layer.provide(
      Layer.merge(parser, WriteOnlyValuesWebCrypto(config.MASTER_KEY))
    )
  );

/** The project service's env as the Worker composes it. */
export const envLive = (
  config: PlatformConfig
): Layer.Layer<never, never, RepoHost> =>
  envOn(config, EnvSchemaParserOffEntry);
