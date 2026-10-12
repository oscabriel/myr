import { Duration, Schema } from "effect";

import { Revision } from "../repo-host.ts";

export const Code = Schema.Literals([
  "ALREADY_EXISTS",
  "NOT_FOUND",
  "CREATE_IN_PROGRESS",
  "IMPORT_IN_PROGRESS",
  "FORK_IN_PROGRESS",
  "INVALID_INPUT",
  "INVALID_REPO_NAME",
  "INVALID_TTL",
  "INVALID_URL",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
  "MEMORY_LIMIT",
  "INTERNAL_ERROR",
]);

export type Code = typeof Code.Type;

export const isCode = Schema.is(Code);

/** Artifacts' errors page gives `CREATE_IN_PROGRESS` no number. */
export const NUMBERED: ReadonlyMap<number, Code> = new Map<number, Code>([
  [10_100, "INVALID_INPUT"],
  [10_101, "INVALID_REPO_NAME"],
  [10_103, "INVALID_TTL"],
  [10_104, "INVALID_URL"],
  [10_106, "REMOTE_AUTH_REQUIRED"],
  [10_200, "NOT_FOUND"],
  [10_201, "ALREADY_EXISTS"],
  [10_302, "IMPORT_IN_PROGRESS"],
  [10_303, "FORK_IN_PROGRESS"],
  [10_400, "INTERNAL_ERROR"],
  [10_401, "UPSTREAM_UNAVAILABLE"],
  [10_402, "MEMORY_LIMIT"],
]);

export const NO_SOURCE = [
  "INVALID_INPUT",
  "INVALID_URL",
  "MEMORY_LIMIT",
  "NOT_FOUND",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
] as const satisfies readonly Code[];

export const refOf = (at: Revision) =>
  Revision.$match(at, {
    Branch: ({ name }) => name,
    Commit: ({ sha }) => sha,
  });

const MIN_TTL_SECONDS = 60;

const MAX_TTL_SECONDS = 31_536_000;

export const secondsOf = (ttl: Duration.Duration) =>
  Math.min(
    Math.max(Math.ceil(Duration.toSeconds(ttl)), MIN_TTL_SECONDS),
    MAX_TTL_SECONDS
  );

export const LOG_PAGE = 1000;
