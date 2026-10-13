import type { ProjectName } from "@repo/protocol/ids";

import { revSegment } from "./rev.ts";

export const pathSegments = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

const under = (prefix: string, path: string | undefined) =>
  path === undefined || path === ""
    ? prefix
    : `${prefix}/${pathSegments(path)}`;

export const treeHref = (project: ProjectName, rev: string, path?: string) =>
  under(`/${project}/tree/${revSegment(rev)}`, path);

export const blobHref = (project: ProjectName, rev: string, path: string) =>
  under(`/${project}/blob/${revSegment(rev)}`, path);

export const rawHref = (project: ProjectName, rev: string, path: string) =>
  under(`/${project}/raw/${revSegment(rev)}`, path);

export const whyHref = (project: ProjectName, rev: string, path: string) =>
  under(`/${project}/why/${revSegment(rev)}`, path);

/**
 * An `AppLink` takes the bare log as its `to` and the query as its `search`, or
 * the router reads the query as part of the revision.
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

/** A commit's page: its id, or the id inside a fork (`@<handle>/<ask>:<sha>`), as one segment. */
export const commitHref = (project: ProjectName, sha: string) =>
  `/${project}/commit/${revSegment(sha)}`;

export const shortSha = (sha: string) => sha.slice(0, 7);

export const dirOf = (path: string) => {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? "" : path.slice(0, slash);
};

export const ancestorsOf = (path: string): readonly string[] =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"));

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

export const isImage = (path: string) => IMAGE.test(path);

export const isMarkdown = (path: string) => MARKDOWN.test(path);

export const showsCode = (
  file: {
    readonly binary: boolean;
    readonly path: string;
    readonly text?: string | undefined;
  },
  plain: boolean
) =>
  !file.binary &&
  file.text !== undefined &&
  (plain || !(isImage(file.path) || isMarkdown(file.path)));

export const diffAnchor = (path: string) => `diff-${encodeURIComponent(path)}`;
