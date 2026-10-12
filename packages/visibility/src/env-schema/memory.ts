import type { RepoPath } from "@repo/protocol/ids";
import { Effect, Layer } from "effect";

import {
  EnvSchemaParser,
  EnvSchemaUnreadable,
  withImports,
} from "../env-schema.ts";
import type { ParsedEnvSchema } from "../env-schema.ts";

export const EnvSchemaParserMemory = (
  parsed: ReadonlyMap<RepoPath, ParsedEnvSchema>
): Layer.Layer<EnvSchemaParser> =>
  Layer.succeed(EnvSchemaParser, {
    parse: (file) => {
      const schema = parsed.get(file);

      return schema === undefined
        ? Effect.fail(
            new EnvSchemaUnreadable({ file, reason: "no such schema" })
          )
        : withImports(file, schema);
    },
  });
