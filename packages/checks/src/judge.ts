/**
 * The judge closure: every file that decides what an answer's checks do, so
 * no answer may change it (GLOSSARY "Judge closure"). It is data: globs, plus
 * JSON pointers into files an answer may still edit elsewhere, such as
 * `package.json#/scripts` beside its dependencies. Pure; it reads only the
 * file contents it is given.
 */
import { Brand } from "@repo/brand";
import { Glob } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import type { RunBlock } from "@repo/protocol/domain/run";
import { Equal, Option, Predicate, Result, Schema } from "effect";

import type { RepoFile } from "./finder.ts";

/** A closure glob that starts with this takes paths back out of the closure. */
const EXCLUDE = "!";

/**
 * What every project's judge holds before its run block adds to it (spec
 * §4.2 `packages/gate`): the config folder, the env schema and committed env
 * files (never `*.local` ones), CI, test and lint config, the tsconfig files,
 * git and harness hook config, and generated contribute skills. W4 issue 411
 * adds lint plugin sources, rule fixtures and more harnesses.
 */
export const defaultJudgeGlobs: readonly Glob[] = [
  `${Brand.configDir}/**`,
  "**/.env.schema",
  "**/.env.*",
  `${EXCLUDE}**/.env.local`,
  `${EXCLUDE}**/.env.*.local`,
  ".github/workflows/**",
  ".github/actions/**",
  ".forgejo/**",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/vite.config.*",
  "**/oxlint.config.*",
  "**/.oxlintrc*",
  "**/eslint.config.*",
  "**/.eslintrc*",
  "**/biome.json*",
  "**/tsconfig*.json",
  "tools/oxlint/**",
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
  ".lefthook.yaml",
  ".husky/**",
  ".pre-commit-config.yaml",
  ".claude/settings*.json",
  ".cursor/hooks.json",
  ".pi/**",
  ".agents/skills/*-contribute/**",
  ".claude/skills/*-contribute/**",
].map((glob) => Glob.make(glob));

const withoutDotSlash = (path: string) => path.replace(/^(?:\.\/)+/u, "");

// One path segment against one glob segment: `*` is any run of characters
// and `?` is one, never a `/`. Greedy, backing up to the last `*` on a miss.
const matchSegment = (pattern: string, text: string): boolean => {
  let at = 0;
  let from = 0;
  let star = -1;
  let resume = 0;

  while (from < text.length) {
    const wanted = pattern[at];

    if (wanted === "?" || (wanted !== "*" && wanted === text[from])) {
      at += 1;
      from += 1;
    } else if (wanted === "*") {
      star = at;
      resume = from;
      at += 1;
    } else if (star === -1) {
      return false;
    } else {
      at = star + 1;
      resume += 1;
      from = resume;
    }
  }

  while (pattern[at] === "*") {
    at += 1;
  }

  return at === pattern.length;
};

const matchSegments = (
  globs: readonly string[],
  parts: readonly string[]
): boolean => {
  const [glob, ...restGlobs] = globs;

  if (glob === undefined) {
    return parts.length === 0;
  }

  if (glob === "**") {
    return [...parts.keys(), parts.length].some((skip) =>
      matchSegments(restGlobs, parts.slice(skip))
    );
  }

  const [part, ...restParts] = parts;

  return (
    part !== undefined &&
    matchSegment(glob, part) &&
    matchSegments(restGlobs, restParts)
  );
};

/**
 * Whether a repo path matches a glob: `**` as a whole segment is any number
 * of directories (none included), `*` is any run of characters within a
 * segment and `?` one character. A leading dot is matched like any other
 * character, so `*` reaches dotfiles. No braces, no classes, no negation.
 * Pure and dependency-free, so the gate can copy it.
 */
export const matchGlob = (glob: string, path: string): boolean =>
  matchSegments(
    withoutDotSlash(glob).split("/"),
    withoutDotSlash(path).split("/")
  );

/**
 * Whether an answer that changes `path` changes the judge: some closure glob
 * matches it and no `!` glob takes it back out. A JSON pointer never judges a
 * whole file (`package.json` stays editable); `touchedPointers` reads those.
 */
export const isJudged = (closure: Policy["judge"], path: string): boolean => {
  const excluded = closure.paths.some(
    (glob) =>
      glob.startsWith(EXCLUDE) && matchGlob(glob.slice(EXCLUDE.length), path)
  );

  return (
    !excluded &&
    closure.paths.some(
      (glob) => !glob.startsWith(EXCLUDE) && matchGlob(glob, path)
    )
  );
};

const Extends = Schema.fromJsonString(
  Schema.Struct({
    extends: Schema.optionalKey(
      Schema.Union([Schema.String, Schema.Array(Schema.String)])
    ),
  })
);

const decodeExtends = Schema.decodeOption(Extends);

const dirname = (path: string) => path.split("/").slice(0, -1).join("/");

// `a/b` joined with `../c` is `c`; `..` above the root leaves the repo.
const join = (dir: string, relative: string): Option.Option<string> => {
  const parts: string[] = dir === "" ? [] : dir.split("/");

  for (const part of relative.split("/")) {
    if (part === "..") {
      if (parts.pop() === undefined) {
        return Option.none();
      }
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return Option.some(parts.join("/"));
};

// `./base` names `base.json` when only that exists, as TypeScript resolves it.
const resolveExtends = (
  from: string,
  specifier: string,
  contents: ReadonlyMap<string, string>
): Option.Option<string> =>
  specifier.startsWith(".")
    ? Option.flatMap(join(dirname(from), specifier), (path) =>
        Option.fromNullishOr(
          [path, `${path}.json`].find((candidate) => contents.has(candidate))
        )
      )
    : Option.none();

/**
 * The files a tsconfig extends, followed until the chain ends or leaves the
 * repo. A package specifier (`@tsconfig/node24`) is a dependency, not a path.
 * A file that doesn't parse as JSON ends its branch (411 reads JSONC).
 */
const extendsChain = (
  start: string,
  contents: ReadonlyMap<string, string>
): readonly string[] => {
  const seen = new Set<string>();
  const queue = [start];

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const parent = decodeExtends(contents.get(next) ?? "").pipe(
      Option.flatMapNullishOr((config) => config.extends),
      Option.map((specifiers) => [specifiers].flat()),
      Option.getOrElse((): readonly string[] => [])
    );

    for (const specifier of parent) {
      const resolved = resolveExtends(next, specifier, contents);

      if (Option.isSome(resolved) && !seen.has(resolved.value)) {
        seen.add(resolved.value);
        queue.push(resolved.value);
      }
    }
  }

  return [...seen];
};

// A command's words that could name a file: split on whitespace and shell
// operators, unquoted, and the value of a `--flag=value`.
const wordsOf = (command: string): readonly string[] =>
  command
    .split(/[\s;&|()<>]+/u)
    .map((word) => word.replaceAll(/^["']|["']$/gu, ""))
    .flatMap((word) => [word, word.slice(word.indexOf("=") + 1)])
    .map(withoutDotSlash);

const isPackageJson = (path: string) => matchGlob("**/package.json", path);

const SCRIPTS = "#/scripts";

/**
 * A judge closure as data, the shape `Policy.judge` stores: globs (a `!` glob
 * takes paths back out), and `<file>#<JSON pointer>` parts of files.
 */
export interface JudgeClosure {
  readonly paths: readonly Glob[];
  readonly pointers: readonly string[];
}

/**
 * The judge closure for a run block over a repo's files: the defaults, every
 * existing file a run command names (`./test.sh` → `test.sh`), each tsconfig's
 * `extends` chain, and each `package.json`'s scripts as a pointer. Its shape
 * is `@repo/rules`' `Finishers.judgeClosure`, so the platform passes it in.
 */
export const judgeClosure = (
  run: RunBlock,
  files: readonly RepoFile[]
): JudgeClosure => {
  const contents = new Map(
    files.map((file) => [withoutDotSlash(file.path), file.content])
  );

  const commands = [
    run.setup,
    run.doctor,
    run.test,
    ...Object.values(run.checks),
  ].filter(Predicate.isNotUndefined);

  // A `package.json` a command names stays editable: only its scripts judge.
  const named = commands
    .flatMap(wordsOf)
    .filter((word) => contents.has(word) && !isPackageJson(word));

  const chains = [...contents.keys()]
    .filter((path) => matchGlob("**/tsconfig*.json", path))
    .flatMap((path) => extendsChain(path, contents));

  const defaults = new Set<string>(defaultJudgeGlobs);

  const added = [...new Set([...named, ...chains])]
    .filter((path) => !defaults.has(path))
    .toSorted()
    .map((path) => Glob.make(path));

  const packages = [...contents.keys()].filter(isPackageJson).toSorted();

  const pointers = [
    ...packages.filter((path) => path === "package.json"),
    ...packages.filter((path) => path !== "package.json"),
  ].map((path) => `${path}${SCRIPTS}`);

  return { paths: [...defaultJudgeGlobs, ...added], pointers };
};

const decodeJson = Schema.decodeOption(Schema.fromJsonString(Schema.Json));

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

// RFC 6901: `/a~1b` is the key `a/b`; `~0` is `~`.
const pointerTokens = (pointer: string): readonly string[] =>
  pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

// One step down a JSON value: an object's own key, or an array's index.
const childAt = (
  value: Schema.Json,
  token: string
): Option.Option<Schema.Json> => {
  if (isJsonArray(value)) {
    return /^(?:0|[1-9]\d*)$/u.test(token)
      ? Option.fromNullishOr(value[Number(token)])
      : Option.none();
  }

  return isJsonObject(value) && Object.hasOwn(value, token)
    ? Option.fromNullishOr(value[token])
    : Option.none();
};

const valueAt = (
  json: Schema.Json,
  tokens: readonly string[]
): Option.Option<Schema.Json> => {
  let value = Option.some(json);

  for (const token of tokens) {
    value = Option.flatMap(value, (current) => childAt(current, token));
  }

  return value;
};

// What one side of a change holds at a pointer: nothing (no file, or no such
// key), the value, or the text of a file that isn't JSON.
const read = (
  file: RepoFile | undefined,
  target: string,
  tokens: readonly string[]
): Option.Option<Result.Result<Schema.Json, string>> =>
  file === undefined || !matchGlob(target, file.path)
    ? Option.none()
    : Option.match(decodeJson(file.content), {
        onNone: () => Option.some(Result.fail(file.content)),
        onSome: (json) => Option.map(valueAt(json, tokens), Result.succeed),
      });

/**
 * The closure's pointers whose value differs between a file's two versions:
 * `["package.json#/scripts"]` when a script changed, `[]` for a dependency
 * edit. Values compare as JSON, so moving a key or reformatting is no change.
 * A file added (no `before`), deleted (no `after`), or no longer valid JSON
 * counts as a change.
 */
export const touchedPointers = (
  closure: Policy["judge"],
  before: RepoFile | undefined,
  after?: RepoFile
): readonly string[] =>
  closure.pointers.filter((pointer) => {
    const hash = pointer.indexOf("#");
    const target = hash === -1 ? pointer : pointer.slice(0, hash);
    const tokens = pointerTokens(hash === -1 ? "" : pointer.slice(hash + 1));

    return !Equal.equals(
      read(before, target, tokens),
      read(after, target, tokens)
    );
  });
