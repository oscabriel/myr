/**
 * The visibility cartridge's env, as the platform provides it: the project
 * service's `ProjectEnv` over an `.env.schema` parser and the vault that seals
 * write-only values under the stage's `MASTER_KEY` (a WebCrypto envelope). It
 * reads each project's schemas at the landed SHA through the platform's
 * `RepoHost`, the public namespace's. The parser is the visibility package's
 * adapter over `@env-spec/parser`, which reads a schema into plain data and
 * runs nothing in it.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { ProjectEnvLive } from "@repo/project/visibility/env";
import { EnvSchemaParserEnvSpec } from "@repo/visibility/env-schema/env-spec";
import { WriteOnlyValuesWebCrypto } from "@repo/visibility/vault/webcrypto";
import { Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";

/** The project service's env for one stage's config, as the Worker composes it. */
export const envLive = (
  config: PlatformConfig
): Layer.Layer<never, never, RepoHost> =>
  ProjectEnvLive.pipe(
    Layer.provide(
      Layer.merge(
        EnvSchemaParserEnvSpec,
        WriteOnlyValuesWebCrypto(config.MASTER_KEY)
      )
    )
  );
