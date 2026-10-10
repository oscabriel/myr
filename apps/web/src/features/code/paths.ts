/**
 * The code browser's addresses, one function per page, so every link to a
 * folder, a file, its bytes, its history or a commit is spelled one way.
 * A revision is one URL segment (`revSegment`: a tag's `/` and `@` are
 * encoded); a repo path keeps its `/` and encodes each segment.
 */
import type { ProjectName } from "@repo/protocol/ids";

import { revSegment } from "./rev.ts";

/** `path` in a URL: each segment encoded, the slashes kept. */
export const pathSegments = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

/** `/<prefix>` followed by `/<path>` when there is one. */
const under = (prefix: string, path: string | undefined) =>
  path === undefined || path === ""
    ? prefix
    : `${prefix}/${pathSegments(path)}`;

/** A folder at `rev`; the root when `path` is absent. */
export const treeHref = (project: ProjectName, rev: string, path?: string) =>
  under(`/${project}/tree/${revSegment(rev)}`, path);

/** A file at `rev`. */
export const blobHref = (project: ProjectName, rev: string, path: string) =>
  under(`/${project}/blob/${revSegment(rev)}`, path);

/** A file's bytes at `rev`, as the platform serves them. */
export const rawHref = (project: ProjectName, rev: string, path: string) =>
  under(`/${project}/raw/${revSegment(rev)}`, path);

/** Why each line of a file at `rev` is there (the why page). */
export const whyHref = (project: ProjectName, rev: string, path: string) =>
  under(`/${project}/why/${revSegment(rev)}`, path);

/**
 * The log from `rev`: only the commits that changed `path` when given, from
 * the `from`th. An `AppLink` takes the bare log as its `to` and the query
 * as its `search`, or the router reads the query as part of the revision.
 */
export const commitsHref = (
  project: ProjectName,
  rev: string,
  {
    from,
    path,
    show,
  }: {
    readonly from?: number;
    readonly path?: string;
    /** Only the answers or the asks' openings; every commit when absent. */
    readonly show?: "answers" | "openings";
  } = {}
) => {
  const query = new URLSearchParams();

  if (path !== undefined) {
    query.set("path", path);
  }

  if (from !== undefined && from > 0) {
    query.set("from", String(from));
  }

  if (show !== undefined) {
    query.set("show", show);
  }

  const search = query.toString();

  return `/${project}/commits/${revSegment(rev)}${search === "" ? "" : `?${search}`}`;
};

/** One commit. */
export const commitHref = (project: ProjectName, sha: string) =>
  `/${project}/commit/${sha}`;

/** A commit's id as a person reads it. */
export const shortSha = (sha: string) => sha.slice(0, 7);

/** The folder holding `path`: `""` for a file at the root. */
export const dirOf = (path: string) => {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? "" : path.slice(0, slash);
};

/** Each folder above `path`, outermost first: `a/b/c` gives `a` and `a/b`. */
export const ancestorsOf = (path: string): readonly string[] =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"));

/** A size as a person reads it: bytes, then KiB, MiB and GiB to one decimal. */
export const sizeInWords = (bytes: number) => {
  const units = ["KiB", "MiB", "GiB"] as const;

  if (bytes < 1024) {
    return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  }

  const step = Math.min(
    units.length,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );

  return `${(bytes / 1024 ** step).toFixed(1)} ${units[step - 1] ?? "GiB"}`;
};

const IMAGE = /\.(?:png|jpe?g|gif|webp|avif|ico|svg)$/iu;

const MARKDOWN = /\.(?:md|markdown|mdown)$/iu;

/** Whether the platform serves `path` as an image a page may show inline. */
export const isImage = (path: string) => IMAGE.test(path);

/** Whether `path` is Markdown, rendered on its page. */
export const isMarkdown = (path: string) => MARKDOWN.test(path);

/** The id of a changed file's diff on its commit's page. */
export const diffAnchor = (path: string) => `diff-${encodeURIComponent(path)}`;
