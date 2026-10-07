/**
 * Import direction's pure core: which imports cross a line the workspace
 * graph forbids. `scripts/imports.ts` feeds it the committable TypeScript
 * files and the workspaces; tests feed it fixture files.
 *
 * The first rule: apps never import apps (AGENTS.md principle 6).
 */

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface Workspace {
  /** The workspace's folder, relative to the repo root: `apps/platform`. */
  readonly dir: string;
  readonly name: string;
  /** Every package named in `dependencies` and `devDependencies`. */
  readonly dependencies: readonly string[];
}

export interface ImportViolation {
  readonly path: string;
  /** 1-based: the line the specifier is on. */
  readonly line: number;
  readonly specifier: string;
  readonly rule: string;
}

// The specifier of a static import or re-export (`… from "x"`), a bare
// `import "x"`, or a dynamic `import("x")`. A `from` clause may span lines.
const IMPORT =
  /\b(?:import|export)\s[^;]*?\bfrom\s*(?<quote>["'])(?<from>[^"'\n]+)\k<quote>|\bimport\s*(?<bareQuote>["'])(?<bare>[^"'\n]+)\k<bareQuote>|\bimport\s*\(\s*(?<dynamicQuote>["'])(?<dynamic>[^"'\n]+)\k<dynamicQuote>\s*\)/gu;

interface Found {
  readonly specifier: string;
  readonly line: number;
}

const importsIn = (content: string): readonly Found[] =>
  [...content.matchAll(IMPORT)].flatMap((match) => {
    const specifier =
      match.groups?.from ?? match.groups?.bare ?? match.groups?.dynamic;

    if (specifier === undefined) {
      return [];
    }

    const at = match.index + match[0].lastIndexOf(specifier);

    return [{ line: content.slice(0, at).split("\n").length, specifier }];
  });

/** `a/b/../c/./d` as `a/c/d`; `undefined` when it climbs out of the repo. */
const normalize = (path: string): string | undefined => {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "..") {
      if (parts.length === 0) {
        return undefined;
      }

      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return parts.join("/");
};

const dirname = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

const isInside = (dir: string, path: string) =>
  path === dir || path.startsWith(`${dir}/`);

/** The workspace a repo path belongs to: the deepest one that holds it. */
const owner = (path: string, workspaces: readonly Workspace[]) =>
  workspaces
    .filter((workspace) => isInside(workspace.dir, path))
    .toSorted((a, b) => b.dir.length - a.dir.length)[0];

/** The workspace an import reaches, by package name or by relative path. */
const target = (
  file: SourceFile,
  specifier: string,
  workspaces: readonly Workspace[]
) => {
  if (specifier.startsWith(".")) {
    const resolved = normalize(`${dirname(file.path)}${specifier}`);

    return resolved === undefined ? undefined : owner(resolved, workspaces);
  }

  return workspaces.find(
    (workspace) =>
      specifier === workspace.name || specifier.startsWith(`${workspace.name}/`)
  );
};

const isApp = (workspace: Workspace) => workspace.dir.startsWith("apps/");

/** Every import that breaks a rule, in file order, then line order. */
export const findViolations = (
  files: readonly SourceFile[],
  workspaces: readonly Workspace[]
): readonly ImportViolation[] =>
  files.flatMap((file) => {
    const from = owner(file.path, workspaces);

    if (from === undefined || !isApp(from)) {
      return [];
    }

    return importsIn(file.content).flatMap(({ line, specifier }) => {
      const to = target(file, specifier, workspaces);

      return to !== undefined && to !== from && isApp(to)
        ? [{ line, path: file.path, rule: "app-imports-app", specifier }]
        : [];
    });
  });
