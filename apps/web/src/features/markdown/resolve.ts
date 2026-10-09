/**
 * Where a link or an image in a project's Markdown file points, inside the
 * web: the file was read at one commit, in one directory, so a relative
 * URL names a path in that commit's tree, as GitHub resolves a README's
 * links. The result always names the SHA, never `main`, so it reads the
 * same tree forever (and a raw image caches forever, ADR 0019).
 *
 * Pure, so the rules are table-tested on their own; `pipeline.ts` runs it
 * over the rendered tree before the sanitizer sees it.
 */
import type { CommitSha, ProjectName } from "@repo/protocol/ids";

/** Where the file was read: the project, the commit, its directory, and what kind of URL this is. */
export interface RepoUrlContext {
  /** The file's directory, relative to the repo root; `""` is the root. */
  readonly dir: string;
  /** A link opens a page (`blob`, or `tree` for a folder); media loads the raw bytes. */
  readonly kind: "link" | "media";
  readonly project: ProjectName;
  readonly sha: CommitSha;
}

/** A URL scheme (`https:`, `mailto:`, `javascript:` …): the URL leaves the repo, and the sanitizer judges it. */
const scheme = /^[a-z][a-z0-9+.-]*:/iu;

/** A base no reader resolves against; only its path is kept. */
const base = "https://repo.invalid/";

const edgeSlashes = /^\/+|\/+$/gu;

/** Media reads raw bytes; a link opens a folder (`tree`) when its path ends in `/`, else a file (`blob`). */
const routeOf = (kind: RepoUrlContext["kind"], pathname: string) => {
  if (kind === "media") {
    return "raw";
  }

  return pathname.endsWith("/") ? "tree" : "blob";
};

/**
 * Resolve `url` against the file's directory at `sha`:
 *
 * - `#…`, `""`, `//host…` and anything with a scheme come back as written;
 * - `/x` starts at the repo root, anything else at `dir`; `..` stops at
 *   the root (the URL parser clamps it), and a `?query` and `#hash` stay;
 * - a link becomes `/<project>/blob/<sha>/<path>`, or `/tree/` when it ends
 *   in `/` (a folder); media becomes `/<project>/raw/<sha>/<path>`.
 *
 * Only the parsed path is kept, so a URL the parser reads as another host
 * (`/\host/x`) still lands inside the project.
 */
export const resolveRepoUrl = (url: string, at: RepoUrlContext): string => {
  if (
    url === "" ||
    url.startsWith("#") ||
    url.startsWith("//") ||
    scheme.test(url)
  ) {
    return url;
  }

  const folder = at.dir
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const resolved = URL.parse(url, folder === "" ? base : `${base}${folder}/`);

  if (resolved === null) {
    return "";
  }

  const path = resolved.pathname.replaceAll(edgeSlashes, "");

  const route = routeOf(at.kind, resolved.pathname);

  return `/${at.project}/${route}/${at.sha}${path === "" ? "" : `/${path}`}${resolved.search}${resolved.hash}`;
};
