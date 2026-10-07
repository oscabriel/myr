import { Handle } from "@repo/protocol/ids";
import { Effect, Layer, Redacted, Schema, SchemaIssue } from "effect";

import { MemorySessions } from "./sessions/memory.ts";
import { Vacant } from "./vacant.ts";

/** What the platform reads from the Worker's env. */
const PlatformEnv = Schema.Struct({
  OPERATOR_HANDLE: Handle,
  OPERATOR_TOKEN: Schema.RedactedFromValue(
    Schema.String.check(Schema.isMinLength(32))
  ),
});

/**
 * The Worker's env cannot run the platform. It names the keys only: a value
 * that failed to decode may be a secret.
 */
export class InvalidEnv extends Schema.TaggedError<InvalidEnv>()("InvalidEnv", {
  keys: Schema.Array(Schema.String),
}) {}

const failingKeys = (issue: SchemaIssue.Issue) =>
  SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues.map(
    ({ path = [] }) => path.map(String).join(".")
  );

/** The surfaces' services from the Worker's env, decoded once. */
export const platform = (env: Env) =>
  Layer.unwrap(
    Schema.decodeEffect(PlatformEnv, { errors: "all" })(env).pipe(
      Effect.mapError(
        ({ issue }) => new InvalidEnv({ keys: failingKeys(issue) })
      ),
      Effect.map(({ OPERATOR_HANDLE, OPERATOR_TOKEN }) =>
        Layer.mergeAll(
          Vacant,
          MemorySessions.layer({
            [Redacted.value(OPERATOR_TOKEN)]: { handle: OPERATOR_HANDLE },
          })
        )
      )
    )
  );
