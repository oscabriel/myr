// ts-morph bundles the TypeScript compiler: only Bun hosts import this module, never a Worker.
import { WeakCheck } from "@repo/protocol/refusal";
import { Array, Effect, Option, pipe, Predicate, Result, Schema } from "effect";
import { Node, Project, ts } from "ts-morph";
import type { ImportDeclaration, SourceFile } from "ts-morph";

import { diagnose, Diagnosis } from "./classify.ts";
import type { RepoFile } from "./finder.ts";
import { matchGlob } from "./judge.ts";
import type { RunEvidence } from "./red-first.ts";

export class NullAnswerFailed extends Schema.TaggedError<NullAnswerFailed>()(
  "NullAnswerFailed",
  { path: Schema.String, reason: Schema.String }
) {}

export interface NullAnswerTerritory {
  readonly paths: readonly string[];
  readonly publicFiles?: readonly string[];
}

interface Edit {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

const NULL_BODY = "{ return undefined as never; }";

const NULL_EXPRESSION = "undefined as never";

const SOURCE = /\.(?:[cm]?ts|tsx)$/u;

const DECLARATION = /\.d\.[cm]?ts$/u;

const isSource = (path: string) => SOURCE.test(path) && !DECLARATION.test(path);

const EXCLUDE = "!";

const inTerritory = (territory: NullAnswerTerritory, path: string) =>
  territory.paths.some(
    (glob) => !glob.startsWith(EXCLUDE) && matchGlob(glob, path)
  ) &&
  !territory.paths.some(
    (glob) =>
      glob.startsWith(EXCLUDE) && matchGlob(glob.slice(EXCLUDE.length), path)
  );

const ROOT = "/";

const placed = (path: string) => `${ROOT}${path}`;

const repoPathOf = (file: SourceFile) => file.getFilePath().slice(ROOT.length);

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  target: ts.ScriptTarget.ES2023,
};

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optionalKey(Schema.Json),
    main: Schema.optionalKey(Schema.Json),
  })
);

const decodeManifest = Schema.decodeUnknownOption(Manifest);

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  globalThis.Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value) && !isJsonArray(value);

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

const targetsOf = ({
  exports,
  main,
}: typeof Manifest.Type): readonly string[] =>
  exports === undefined
    ? [main].filter(Predicate.isString)
    : exportTargets(exports);

const PATTERN = "*";

const targetPaths = (
  target: string,
  paths: readonly string[]
): readonly string[] => {
  const star = target.indexOf(PATTERN);

  if (star === -1) {
    return [target];
  }

  const head = target.slice(0, star);
  const tail = target.slice(star + PATTERN.length);

  return paths.filter(
    (path) =>
      path.length > head.length + tail.length &&
      path.startsWith(head) &&
      path.endsWith(tail)
  );
};

const folderOf = (path: string) => {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? "" : path.slice(0, slash);
};

const joined = (folder: string, path: string) =>
  folder === "" ? path : `${folder}/${path}`;

const foldersAbove = (path: string): readonly string[] => {
  const folders: string[] = [];
  let folder = folderOf(path);

  while (folder !== "") {
    folders.push(folder);
    folder = folderOf(folder);
  }

  return [...folders, ""];
};

const manifestEntries = (
  files: readonly RepoFile[],
  territory: NullAnswerTerritory
): readonly string[] => {
  const texts = new Map(files.map(({ content, path }) => [path, content]));
  const paths = [...texts.keys()];

  const manifests = pipe(
    files,
    Array.filter(({ path }) => inTerritory(territory, path)),
    Array.flatMap(({ path }) =>
      Option.toArray(
        Array.findFirst(foldersAbove(path), (folder) =>
          texts.has(joined(folder, "package.json"))
        )
      )
    ),
    Array.dedupe
  );

  return pipe(
    manifests,
    Array.flatMap((folder) =>
      pipe(
        Option.fromUndefinedOr(texts.get(joined(folder, "package.json"))),
        Option.flatMap(decodeManifest),
        Option.match({
          onNone: () => [],
          onSome: (manifest) =>
            targetsOf(manifest).flatMap((target) =>
              targetPaths(
                joined(folder, target.replace(/^(?:\.\/)+/u, "")),
                paths
              )
            ),
        })
      )
    ),
    Array.filter((path) => texts.has(path) && isSource(path)),
    Array.dedupe
  );
};

const bodyEdit = (body: Node | undefined): readonly Edit[] => {
  if (body === undefined) {
    return [];
  }

  return [
    {
      end: body.getEnd(),
      start: body.getStart(),
      text: Node.isBlock(body) ? NULL_BODY : NULL_EXPRESSION,
    },
  ];
};

const unwrapped = (node: Node): Node =>
  Node.isParenthesizedExpression(node) ||
  Node.isAsExpression(node) ||
  Node.isSatisfiesExpression(node)
    ? unwrapped(node.getExpression())
    : node;

const stubsOf = (node: Node): readonly Edit[] => {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node)
  ) {
    return bodyEdit(node.getBody());
  }

  if (Node.isVariableDeclaration(node) || Node.isPropertyDeclaration(node)) {
    const value = node.getInitializer();

    return value === undefined ? [] : stubsOf(unwrapped(value));
  }

  if (Node.isExportAssignment(node)) {
    return stubsOf(unwrapped(node.getExpression()));
  }

  if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
    return node
      .getMembers()
      .flatMap((member) =>
        Node.isMethodDeclaration(member) ||
        Node.isGetAccessorDeclaration(member)
          ? bodyEdit(member.getBody())
          : stubsOf(member)
      );
  }

  return [];
};

const edited = (text: string, edits: readonly Edit[]) => {
  const lastFirst = Array.dedupeWith(
    edits,
    (left, right) => left.start === right.start
  ).toSorted((left, right) => right.start - left.start);

  let result = text;

  for (const { end, start, text: replacement } of lastFirst) {
    result = `${result.slice(0, start)}${replacement}${result.slice(end)}`;
  }

  return result;
};

const ownExports = (file: SourceFile): readonly Node[] =>
  [...file.getExportedDeclarations().values()]
    .flat()
    .filter((node) => node.getSourceFile() === file);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

const DEFAULT = "default";

const standIn = (name: string) =>
  `export ${name === DEFAULT ? "default function " : `function ${name}`}(..._args: readonly unknown[]): never ${NULL_BODY}`;

const withStandIns = (text: string, names: readonly string[]) => {
  const lines = names.map(standIn).join("\n");

  if (text === "") {
    return `${lines}\n`;
  }

  return `${text.endsWith("\n") ? text : `${text}\n`}\n${lines}\n`;
};

// What a missing file's import is written as: a script's extension read as
// its TypeScript one, as Bun and `moduleResolution: "bundler"` read it.
const SCRIPT_AS_SOURCE = [
  [/\.js$/u, ".ts"],
  [/\.jsx$/u, ".tsx"],
  [/\.mjs$/u, ".mts"],
  [/\.cjs$/u, ".cts"],
] as const;

const intendedPath = (importer: string, specifier: string) => {
  const segments: string[] = [];

  for (const segment of [
    ...folderOf(importer).split("/"),
    ...specifier.split("/"),
  ]) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }

  const path = segments.join("/");

  const script = SCRIPT_AS_SOURCE.find(([extension]) => extension.test(path));

  if (script !== undefined) {
    return path.replace(script[0], script[1]);
  }

  return SOURCE.test(path) ? path : `${path}.ts`;
};

const valueNamesOf = (declaration: ImportDeclaration): readonly string[] =>
  declaration.isTypeOnly()
    ? []
    : [
        ...(declaration.getDefaultImport() === undefined ? [] : [DEFAULT]),
        ...declaration
          .getNamedImports()
          .filter((specifier) => !specifier.isTypeOnly())
          .map((specifier) => specifier.getName())
          .filter((name) => IDENTIFIER.test(name)),
      ];

const homeOf = (
  territory: NullAnswerTerritory,
  target: SourceFile
): Option.Option<SourceFile> =>
  inTerritory(territory, repoPathOf(target))
    ? Option.some(target)
    : Array.findFirst(target.getExportDeclarations(), (declaration) =>
        Option.fromUndefinedOr(
          declaration.hasNamedExports() || declaration.isNamespaceExport()
            ? undefined
            : declaration.getModuleSpecifierSourceFile()
        ).pipe(
          Option.filter((file) => inTerritory(territory, repoPathOf(file)))
        )
      );

const wantedNames = (
  project: Project,
  territory: NullAnswerTerritory
): ReadonlyMap<string, readonly string[]> => {
  const wanted = new Map<string, string[]>();

  const want = (path: string, names: readonly string[]) => {
    const known = wanted.get(path) ?? [];

    wanted.set(path, Array.dedupe([...known, ...names]));
  };

  for (const importer of project.getSourceFiles()) {
    for (const declaration of importer.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      const names = valueNamesOf(declaration);
      const target = declaration.getModuleSpecifierSourceFile();

      if (specifier.startsWith(".") && Array.isReadonlyArrayNonEmpty(names)) {
        if (target === undefined) {
          const path = intendedPath(repoPathOf(importer), specifier);

          if (inTerritory(territory, path)) {
            want(path, names);
          }
        } else {
          const exported = target.getExportedDeclarations();

          for (const home of Option.toArray(homeOf(territory, target))) {
            const direct = home === target;

            want(
              repoPathOf(home),
              names.filter((name) =>
                name === DEFAULT
                  ? direct && !exported.has(name)
                  : !exported.has(name) && home.getLocal(name) === undefined
              )
            );
          }
        }
      }
    }
  }

  return new Map([...wanted].filter(([, names]) => names.length > 0));
};

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : globalThis.String(cause);

const stubbedContents = (
  files: readonly RepoFile[],
  territory: NullAnswerTerritory,
  entryPaths: readonly string[]
): Result.Result<ReadonlyMap<string, string>, NullAnswerFailed> => {
  const project = new Project({
    compilerOptions: COMPILER_OPTIONS,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    useInMemoryFileSystem: true,
  });

  for (const { content, path } of files) {
    if (isSource(path)) {
      project.createSourceFile(placed(path), content);
    }
  }

  const entries = Array.getSomes(
    entryPaths.map((path) =>
      Option.fromUndefinedOr(project.getSourceFile(placed(path)))
    )
  );

  // A set by reference: Effect's structural `dedupe` would walk each
  // ts-morph node's whole program.
  const reached = [
    ...new Set(
      entries.flatMap((entry) => [
        entry,
        ...[...entry.getExportedDeclarations().values()]
          .flat()
          .map((node) => node.getSourceFile()),
      ])
    ),
  ].filter((file) => inTerritory(territory, repoPathOf(file)));

  const program = project.getProgram();
  const contents = new Map<string, string>();

  for (const file of reached) {
    const [broken] = program.getSyntacticDiagnostics(file);

    if (broken !== undefined) {
      return Result.fail(
        new NullAnswerFailed({
          path: repoPathOf(file),
          reason: ts.flattenDiagnosticMessageText(
            broken.compilerObject.messageText,
            "\n"
          ),
        })
      );
    }

    const edits = ownExports(file).flatMap(stubsOf);

    if (Array.isReadonlyArrayNonEmpty(edits)) {
      contents.set(repoPathOf(file), edited(file.getFullText(), edits));
    }
  }

  for (const [path, names] of wantedNames(project, territory)) {
    const text =
      contents.get(path) ??
      project.getSourceFile(placed(path))?.getFullText() ??
      "";

    contents.set(path, withStandIns(text, names));
  }

  return Result.succeed(contents);
};

// The null answer has only to run: a project with `noUnusedLocals` or
// `noUnusedParameters` will flag the stubs' unread parameters.
export const nullAnswer = (
  files: readonly RepoFile[],
  territory: NullAnswerTerritory
): Effect.Effect<readonly RepoFile[], NullAnswerFailed> =>
  Effect.gen(function* () {
    const where = territory.paths.join(" ");

    const entryPaths =
      territory.publicFiles ?? manifestEntries(files, territory);

    if (!Array.isReadonlyArrayNonEmpty(entryPaths)) {
      return yield* new NullAnswerFailed({
        path: where,
        reason:
          "no entry point: the territory names no public files, and no package.json exports a source file for it",
      });
    }

    const contents = yield* Effect.try({
      catch: (cause) =>
        new NullAnswerFailed({ path: where, reason: messageOf(cause) }),
      try: () => stubbedContents(files, territory, entryPaths),
    }).pipe(Effect.flatMap(Effect.fromResult));

    if (contents.size === 0) {
      return yield* new NullAnswerFailed({
        path: where,
        reason:
          "nothing to stub: the entry points export no function, arrow or class from the territory",
      });
    }

    const given = new Set(files.map(({ path }) => path));

    const added = [...contents]
      .flatMap(([path, content]) =>
        given.has(path) ? [] : [{ content, path }]
      )
      .toSorted((left, right) =>
        left.path < right.path ? -1 : Number(left.path > right.path)
      );

    return [
      ...files.map((file) =>
        pipe(
          Option.fromUndefinedOr(contents.get(file.path)),
          Option.match({
            onNone: () => file,
            onSome: (content) => ({ content, path: file.path }),
          })
        )
      ),
      ...added,
    ];
  });

export const nullAnswerVerdict = (run: RunEvidence): Option.Option<WeakCheck> =>
  Diagnosis.$match(diagnose(run.exit), {
    Blocked: () => Option.none(),
    Failed: () => Option.none(),
    LoadError: () => Option.none(),
    NoTests: () => Option.some(new WeakCheck({ weakness: "no assertion" })),
    Passed: () => Option.some(new WeakCheck({ weakness: "nullAnswer" })),
  });
