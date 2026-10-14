export const LOG_PAGE = 30;

/**
 * What the history shows of a page: the landings alone, the answers, the
 * asks' openings, or every commit. On main the landings are the default; a
 * tag or a fork shows every commit, since a fork's own commits are no landing,
 * and so does a path's history, which asks what touched the path.
 */
export type LogShow = "all" | "answers" | "landings" | "openings";

export const LOG_SHOWS: readonly LogShow[] = [
  "all",
  "answers",
  "landings",
  "openings",
];

export const defaultShowOf = (rev: string, path?: string): LogShow =>
  rev === "main" && path === undefined ? "landings" : "all";
