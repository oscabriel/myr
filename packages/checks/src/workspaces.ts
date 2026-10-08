/**
 * The workspace packages a repo's root manifest declares, read from the
 * files `judgeInputs` gathers (it reads every `package.json`, for the judge
 * closure's own workspace lookups). The platform's facts at a landing and the
 * CLI's local check both read them here, from the same files. Pure.
 */
import { RepoPath } from "@repo/protocol/ids";
import { Array, Option, Predicate, Schema } from "effect";

import type { RepoFile } from "./finder.ts";

/** One workspace package: its folder, its name, and the files its `exports` name. */
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

/** A manifest's `workspaces`: an array of globs, or `{ packages: [...] }`. */
const workspaceGlobs = (value: Schema.Json | undefined): readonly string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (isJsonArray(value)) {
    return strings(value);
  }

  return isJsonObject(value) ? strings(value.packages) : [];
};

/** Every string an `exports` field leads to, nested conditions included. */
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

/** The folders directly in `folder` (`""` is the root) that hold any file, in path order. */
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

/**
 * The folders a workspace glob names: `packages/*` is every folder in
 * `packages`, and a glob with no `*` is its own folder. Deeper globs are
 * read as their folder prefix's children.
 */
const foldersOf = (paths: readonly string[], glob: string) => {
  const clean = withoutDotSlash(glob).replace(/\/+$/u, "");
  const star = clean.indexOf("*");

  return star === -1
    ? [clean]
    : foldersIn(paths, clean.slice(0, star).replace(/\/+$/u, ""));
};

/**
 * Each folder the root `package.json`'s `workspaces` globs name whose own
 * `package.json` has a name, in the globs' order: its folder, its name, and
 * the files its `exports` lead to, from the root. A manifest that doesn't
 * parse (or was too large to read, so its text is empty) declares nothing.
 */
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
