/**
 * What the drafter reads: files picked from the project's canonical tree at
 * the landed commit, deterministically, within a byte budget (W9 §14.7).
 * The caller hands the tree and a reader over the canonical repo only, so
 * no layer's repo can be read here; a path that looks like a layer's or a
 * held-back check's is refused anyway, as is an env file.
 *
 * The order is the priority: the root READMEs, the root manifest, the
 * project module, an existing ask with its test as a style example, then
 * the territory's files (or, with none given, the source files whose path
 * shares the most words with the want, at most 12), each source with its
 * sibling tests, and last every other README. Each file is cut at 40 KB,
 * and the rest of the budget cuts the next one, both with a marker.
 */
import { Brand } from "@repo/brand";
import type { ConfigFile } from "@repo/protocol/domain/common";
import { RepoPath } from "@repo/protocol/ids";
import { Array, Effect, Option, Order, Schema, pipe } from "effect";

/** The bytes the model reads in all, about 50k tokens. */
const defaultBudget = 200 * 1024;

/** The most of one file the model reads. */
const perFile = 40 * 1024;

/** Room kept for a cut file's marker. */
const markerRoom = 64;

/** Source files ranked by the want, when no territory is given. */
const rankedFiles = 12;

const manifests = new Set([
  "Cargo.toml",
  "go.mod",
  "package.json",
  "pyproject.toml",
]);

const sourceExtensions = new Set([
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "ex",
  "exs",
  "go",
  "h",
  "hpp",
  "hs",
  "java",
  "js",
  "jsx",
  "kt",
  "lua",
  "mjs",
  "ml",
  "mts",
  "php",
  "py",
  "rb",
  "rs",
  "scala",
  "sh",
  "swift",
  "ts",
  "tsx",
  "zig",
]);

const testFolders = new Set(["__tests__", "spec", "test", "tests"]);

const vendored = new Set(["dist", "node_modules", "target", "vendor"]);

const stopWords = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "its",
  "not",
  "the",
  "that",
  "this",
  "when",
  "with",
]);

const askFolder = `${Brand.configDir}/asks/`;

const askSuffix = ".ask.ts";

const segmentsOf = (path: string) => path.split("/");

const baseName = (path: string) => segmentsOf(path).at(-1) ?? path;

const folderOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const extensionOf = (path: string) => {
  const name = baseName(path);

  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
};

/** A layer's file, a held-back check, or an env file: never read. */
const isWithheld = (path: string) =>
  path.startsWith(`${Brand.configDir}/layers/`) ||
  segmentsOf(path).some(
    (segment) =>
      segment === "held-back" ||
      (segment.startsWith(".env") && segment !== ".env.schema")
  );

const isReadme = (path: string) => /^readme(?:\.|$)/iu.test(baseName(path));

const isTest = (path: string) =>
  segmentsOf(path).some((segment) => testFolders.has(segment)) ||
  /[._-](?:test|spec)\.[^.]+$/u.test(baseName(path)) ||
  baseName(path).startsWith("test_");

const isSource = (path: string) =>
  sourceExtensions.has(extensionOf(path)) &&
  !isTest(path) &&
  !path.startsWith(`${Brand.configDir}/`) &&
  !segmentsOf(path).some((segment) => vendored.has(segment));

const isAskFile = (path: string) =>
  path.startsWith(askFolder) &&
  path.endsWith(askSuffix) &&
  !path.slice(askFolder.length).includes("/");

/** A file's name without its extensions: `add.test.ts` is `add`. */
const stemOf = (path: string) => baseName(path).split(".")[0] ?? "";

/** A word and its camel-case parts, lower-cased: `addMonths` → addmonths, add, months. */
const wordsOf = (text: string): readonly string[] =>
  text
    .split(/[^A-Za-z0-9]+/u)
    .flatMap((word) =>
      word.length === 0
        ? []
        : [
            word.toLowerCase(),
            ...(word.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/gu) ?? []).map(
              (part) => part.toLowerCase()
            ),
          ]
    )
    .filter((word) => word.length >= 3 && !stopWords.has(word));

/** How many of the want's words a path shares, its extension left out. */
const overlap = (want: ReadonlySet<string>, path: string) =>
  Array.dedupe(
    wordsOf(path.slice(0, path.length - extensionOf(path).length))
  ).filter((word) => want.has(word)).length;

interface Ranked {
  readonly path: string;
  readonly score: number;
}

/** Most shared words first, then by path. */
const byScore = Order.combine(
  Order.mapInput(Order.flip(Order.Number), ({ score }: Ranked) => score),
  Order.mapInput(Order.String, ({ path }: Ranked) => path)
);

/** The source files whose path shares a word with the want, most first, at most `rankedFiles`. */
const ranked = (paths: readonly string[], want: ReadonlySet<string>) =>
  paths
    .flatMap((path): Ranked[] => {
      const score = isSource(path) ? overlap(want, path) : 0;

      return score > 0 ? [{ path, score }] : [];
    })
    .toSorted(byScore)
    .slice(0, rankedFiles)
    .map(({ path }) => path);

/** The tests beside a source file: the same stem with a test suffix, anywhere. */
const siblingTests = (tree: readonly string[], source: string) => {
  const stem = stemOf(source);

  return tree.filter(
    (path) =>
      isTest(path) &&
      path !== source &&
      (stemOf(path) === stem || baseName(path).startsWith(`test_${stem}.`))
  );
};

const decodeLiteral = Schema.decodeOption(Schema.fromJsonString(Schema.String));

/** The test file an ask file names in its `path`, when it names one. */
const askTestPath = (source: string): Option.Option<string> =>
  pipe(
    Option.fromNullishOr(
      /\bpath:\s*(?<literal>"(?:[^"\\\n]|\\.)*")/u.exec(source)?.groups?.literal
    ),
    Option.flatMap(decodeLiteral)
  );

/** The folder the picked style example's test sits in: the project's ask-test folder. */
export const askTestFolderOf = (
  files: readonly ConfigFile[]
): Option.Option<string> =>
  pipe(
    Array.findFirst(files, ({ path }) => isAskFile(path)),
    Option.flatMap(({ content }) => askTestPath(content)),
    Option.map(folderOf)
  );

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/** `content` cut to at most `room` bytes and its marker, or none when nothing fits. */
const cut = (content: string, room: number): Option.Option<string> => {
  const bytes = encoder.encode(content);

  if (bytes.length <= Math.min(room, perFile)) {
    return Option.some(content);
  }

  const shown = Math.min(perFile, room - markerRoom);

  return shown <= 0
    ? Option.none()
    : Option.some(
        `${decoder.decode(bytes.slice(0, shown)).replace(/�$/u, "")}\n[cut: the first ${shown} of ${bytes.length} bytes]\n`
      );
};

/**
 * The files the model reads for a want, in the order above, each read once
 * through `read` and the whole within `budget` bytes. The same tree, in any
 * order, and the same want give the same files.
 */
export const pickFiles = (
  tree: readonly RepoPath[],
  input: { readonly want: string; readonly territory?: readonly RepoPath[] },
  read: (path: RepoPath) => Effect.Effect<string>,
  budget: number = defaultBudget
): Effect.Effect<readonly ConfigFile[]> =>
  Effect.gen(function* () {
    const paths: readonly string[] = Array.dedupe(
      tree.filter((path) => !isWithheld(path)).toSorted(Order.String)
    );

    const rootReadmes = paths.filter(
      (path) => !path.includes("/") && isReadme(path)
    );

    const settings = [
      ...paths.filter((path) => manifests.has(path)),
      ...paths.filter((path) => path === `${Brand.configDir}/project.ts`),
    ];

    const example = Array.last(paths.filter(isAskFile));

    const exampleSource = yield* Option.match(example, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (path) => Effect.asSome(read(RepoPath.make(path))),
    });

    const exampleTest = pipe(
      exampleSource,
      Option.flatMap(askTestPath),
      Option.filter((path) => paths.includes(path))
    );

    const want = new Set(wordsOf(input.want));

    const chosen =
      input.territory === undefined || input.territory.length === 0
        ? ranked(paths, want)
        : paths.filter((path) =>
            (input.territory ?? []).some(
              (territory) =>
                path === territory || path.startsWith(`${territory}/`)
            )
          );

    const withTests = chosen.flatMap((path) => [
      path,
      ...(isTest(path) ? [] : siblingTests(paths, path)),
    ]);

    const otherReadmes = paths.filter(
      (path) => path.includes("/") && isReadme(path)
    );

    const order = Array.dedupe([
      ...rootReadmes,
      ...settings,
      ...Option.toArray(example),
      ...Option.toArray(exampleTest),
      ...withTests,
      ...otherReadmes,
    ]);

    const picked: ConfigFile[] = [];
    let left = budget;

    for (const path of order) {
      const content =
        path === Option.getOrUndefined(example)
          ? Option.getOrElse(exampleSource, () => "")
          : yield* read(RepoPath.make(path));

      const shown = cut(content, left);

      if (Option.isSome(shown)) {
        picked.push({ content: shown.value, path: RepoPath.make(path) });
        left -= encoder.encode(shown.value).length;
      }
    }

    return picked;
  });
