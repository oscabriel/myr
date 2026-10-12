import { RepoPath } from "@repo/protocol/ids";
import { Array, Option, Predicate, Schema } from "effect";

import type { RepoFile } from "./finder.ts";

export interface Workspace {
  readonly dir: string;
  readonly exports: readonly RepoPath[];
  readonly name: string;
}

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optionalKey(Schema.Json),
    name: Schema.optionalKey(Schema.String),
    workspaces: Schema.optionalKey(Schema.Json),
  })
);

const decodeManifest = Schema.decodeUnknownOption(Manifest);

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  globalThis.Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value) && !isJsonArray(value);

const strings = (value: Schema.Json | undefined): readonly string[] =>
  value !== undefined && isJsonArray(value)
    ? value.filter(Predicate.isString)
    : [];

const workspaceGlobs = (value: Schema.Json | undefined): readonly string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (isJsonArray(value)) {
    return strings(value);
  }

  return isJsonObject(value) ? strings(value.packages) : [];
};

const exportTargets = (value: Schema.Json | undefined): readonly string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (Predicate.isString(value)) {
    return [value];
  }

  if (isJsonArray(value)) {
    return value.flatMap(exportTargets);
  }

  return isJsonObject(value) ? Object.values(value).flatMap(exportTargets) : [];
};

const withoutDotSlash = (path: string) => path.replace(/^(?:\.\/)+/u, "");

const foldersIn = (paths: readonly string[], folder: string) => {
  const prefix = folder === "" ? "" : `${folder}/`;

  return Array.dedupe(
    paths.flatMap((path) => {
      if (!path.startsWith(prefix)) {
        return [];
      }

      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");

      return slash === -1 ? [] : [`${prefix}${rest.slice(0, slash)}`];
    })
  );
};

// Deeper globs are read as their folder prefix's children.
const foldersOf = (paths: readonly string[], glob: string) => {
  const clean = withoutDotSlash(glob).replace(/\/+$/u, "");
  const star = clean.indexOf("*");

  return star === -1
    ? [clean]
    : foldersIn(paths, clean.slice(0, star).replace(/\/+$/u, ""));
};

// A manifest that doesn't parse (or was too large, so its text is empty)
// declares nothing.
export const workspacesIn = (
  files: readonly RepoFile[]
): readonly Workspace[] => {
  const sorted = files.toSorted((left, right) =>
    left.path < right.path ? -1 : Number(left.path > right.path)
  );

  const paths = sorted.map(({ path }) => path);
  const texts = new Map(sorted.map(({ content, path }) => [path, content]));

  const manifest = (path: string) =>
    Option.flatMap(Option.fromUndefinedOr(texts.get(path)), decodeManifest);

  const globs = Option.match(manifest("package.json"), {
    onNone: () => [],
    onSome: ({ workspaces }) => workspaceGlobs(workspaces),
  });

  const dirs = Array.dedupe(globs.flatMap((glob) => foldersOf(paths, glob)));

  return dirs.flatMap((dir) =>
    Option.toArray(
      Option.flatMap(manifest(`${dir}/package.json`), ({ exports, name }) =>
        name === undefined || name.length === 0
          ? Option.none()
          : Option.some({
              dir,
              exports: exportTargets(exports).map((target) =>
                RepoPath.make(`${dir}/${withoutDotSlash(target)}`)
              ),
              name,
            })
      )
    )
  );
};
