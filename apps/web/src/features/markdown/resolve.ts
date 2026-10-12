/**
 * The result always names the SHA, never `main`, so it reads the same tree
 * forever.
 */
import type { CommitSha, ProjectName } from "@repo/protocol/ids";

export interface RepoUrlContext {
  readonly dir: string;
  readonly kind: "link" | "media";
  readonly project: ProjectName;
  readonly sha: CommitSha;
}

/**
 * A URL scheme (`https:`, `mailto:`, `javascript:` …): the URL leaves the repo,
 * and the sanitizer judges it.
 */
const scheme = /^[a-z][a-z0-9+.-]*:/iu;

const base = "https://repo.invalid/";

const edgeSlashes = /^\/+|\/+$/gu;

const routeOf = (kind: RepoUrlContext["kind"], pathname: string) => {
  if (kind === "media") {
    return "raw";
  }

  return pathname.endsWith("/") ? "tree" : "blob";
};

/**
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
