import { Result } from "effect";

/**
 * This browser's localStorage, or nothing where reading it throws (a private
 * window, blocked site data, the server). A preference lives here, never in a
 * cookie: a cookie would take the page out of the edge cache.
 */
export const browserStorage = (): Storage | undefined =>
  Result.getOrUndefined(Result.try(() => globalThis.localStorage));
