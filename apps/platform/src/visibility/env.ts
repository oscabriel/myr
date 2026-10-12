import type { RepoHost } from "@repo/artifacts/repo-host";
import { ProjectEnvLive } from "@repo/project/visibility/env";
import { EnvSchemaParserEnvSpec } from "@repo/visibility/env-schema/env-spec";
import { WriteOnlyValuesWebCrypto } from "@repo/visibility/vault/webcrypto";
import { Layer } from "effect";

import type { PlatformConfig } from "../platform.ts";

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
