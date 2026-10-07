/**
 * The policy a local `check` judges by: the config folder at the landed SHA,
 * which locally is `main` (or `--base`), never the answer's own tree (ADR
 * 0005), so editing the rules on HEAD changes nothing here, as it changes
 * nothing on the platform.
 *
 * It is evaluated the way the platform evaluates it: a TypeScript folder
 * bundled with the sdk inlined and run by `@repo/rules`' `/bun` adapter (the
 * Lander's `bundleRules` and the `/worker` evaluator, here on this machine),
 * else its `policy.json` through `/json`, else the defaults; then finished
 * with `@repo/checks`' finder and judge closure, from the same facts the
 * platform reads at a landing (`@repo/project`'s `evaluationFacts`): the
 * files at the root and in the CI folders, the workspaces the root manifest
 * names, and the vouch file.
 */
import { Brand } from "@repo/brand";
import { findRunBlock } from "@repo/checks/finder";
import { judgeClosure } from "@repo/checks/judge";
import type { Policy } from "@repo/protocol/domain/policy";
import { LandedSha, RepoPath } from "@repo/protocol/ids";
import type { CommitSha, Handle, ProjectName } from "@repo/protocol/ids";
import { Finishers } from "@repo/rules/finish";
import {
  RulesEvaluator,
  RulesFailed,
  sdkVersion,
} from "@repo/rules/rules-evaluator";
import type {
  ConfigBundle,
  EvaluationFacts,
} from "@repo/rules/rules-evaluator";
import { rulesEvaluatorBun } from "@repo/rules/rules-evaluator/bun";
import { RulesEvaluatorJson } from "@repo/rules/rules-evaluator/json";
import {
  Array,
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { commitOf, runGit } from "./facts.ts";

/** A file of the config folder, as committed. */
export interface ConfigFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Turns the config folder's files into the bundle the rules evaluator runs:
 * its project module and ask files as self-contained modules, the sdk
 * inlined, and its other files as committed.
 */
export class ConfigBundler extends Context.Service<
  ConfigBundler,
  {
    readonly bundle: (
      files: readonly ConfigFile[]
    ) => Effect.Effect<ConfigBundle, RulesFailed>;
  }
>()("cli/ConfigBundler") {}

/** The project module's path: it names the folder, as the platform's bundles do. */
const configEntry = `${Brand.configDir}/project.ts`;

const SCRIPT = /\.[cm]?[jt]s$/u;

const ASK_FILE = /\.ask\.[cm]?[jt]s$/u;

/** The modules the evaluator imports, each bundled on its own: the project module and every ask. */
const entriesOf = (paths: readonly string[]) =>
  paths.filter(
    (path) =>
      path === configEntry ||
      (path.startsWith(`${Brand.configDir}/asks/`) && ASK_FILE.test(path))
  );

/** Where bun writes an entry's bundle: its path, as JavaScript. */
const bundledAs = (entry: string) => entry.replace(/\.[^./]*$/u, ".js");

const loadFailed = (detail: string) =>
  new RulesFailed({ detail, reason: "load" });

/** A file path from a `file:` URL `import.meta.resolve` gave. */
const fileOf = (path: Path.Path, url: string) =>
  Effect.orDie(path.fromFileUrl(new URL(url)));

/** The `node_modules` folder a resolved module sits in. */
const packagesOf = (file: string) => {
  const at = file.lastIndexOf("/node_modules/");

  return at === -1 ? Option.none() : Option.some(file.slice(0, at + 13));
};

/**
 * The config folder bundled by `bun build`, as the Lander bundles it at a
 * landing: both names of the sdk (the workspace one and the published
 * `<cli package>/rules`) resolve to this CLI's own copy, any other bare
 * import to the packages beside it, macros are off, and code the entries
 * share goes to chunks in the folder. Needs `bun` on the `PATH`.
 */
export const ConfigBundlerBun: Layer.Layer<
  ConfigBundler,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Layer.effect(ConfigBundler)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const sdk = yield* fileOf(path, import.meta.resolve("@repo/sdk"));
    const effect = yield* fileOf(path, import.meta.resolve("effect"));

    /** Writes `content` at `file` under `root`, refusing a path that leaves it. */
    const writeUnder = (root: string, file: string, content: string) => {
      const target = path.join(root, file);
      const relative = path.relative(root, target);

      return relative === "" ||
        relative.startsWith("..") ||
        path.isAbsolute(relative)
        ? Effect.fail(
            loadFailed(`${file}: not a path inside the config folder`)
          )
        : fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(
            Effect.andThen(fs.writeFileString(target, content)),
            Effect.mapError((failure) =>
              loadFailed(`${file}: ${failure.message}`)
            )
          );
    };

    const build = (
      dir: string,
      files: readonly ConfigFile[],
      entries: readonly string[]
    ) =>
      Effect.gen(function* () {
        const root = path.join(dir, "src");
        const out = path.join(dir, "out");
        const tsconfig = path.join(dir, "tsconfig.json");

        for (const file of files) {
          yield* writeUnder(root, file.path, file.content);
        }

        yield* writeUnder(
          dir,
          "tsconfig.json",
          JSON.stringify({
            compilerOptions: {
              paths: {
                [`${Brand.cliPackage}/rules`]: [sdk],
                "@repo/sdk": [sdk],
              },
            },
          })
        );

        yield* Option.match(packagesOf(effect), {
          onNone: () => Effect.void,
          onSome: (packages) =>
            fs
              .symlink(packages, path.join(root, "node_modules"))
              .pipe(Effect.mapError((failure) => loadFailed(failure.message))),
        });

        const ran = yield* Effect.scoped(
          Effect.gen(function* () {
            const child = yield* spawner.spawn(
              ChildProcess.make(
                "bun",
                [
                  "build",
                  "--no-macros",
                  "--target=browser",
                  "--format=esm",
                  "--splitting",
                  `--root=${root}`,
                  `--outdir=${out}`,
                  `--tsconfig-override=${tsconfig}`,
                  "--entry-naming=[dir]/[name].[ext]",
                  `--chunk-naming=${Brand.configDir}/chunk-[hash].[ext]`,
                  ...entries.map((entry) => path.join(root, entry)),
                ],
                { cwd: dir, stdin: "ignore" }
              )
            );

            const [, stderr, exitCode] = yield* Effect.all(
              [
                Stream.runDrain(child.stdout),
                child.stderr.pipe(Stream.decodeText(), Stream.mkString),
                child.exitCode,
              ],
              { concurrency: "unbounded" }
            );

            return { exitCode: Number(exitCode), stderr };
          })
        ).pipe(
          Effect.mapError((failure) =>
            loadFailed(`could not run bun build: ${failure.message}`)
          )
        );

        if (ran.exitCode !== 0) {
          return yield* loadFailed(
            `bun build exited with ${ran.exitCode}: ${ran.stderr}`
          );
        }

        const owners = new Map(
          entries.map((entry) => [bundledAs(entry), entry])
        );

        const written = yield* fs
          .readDirectory(out, { recursive: true })
          .pipe(Effect.mapError((failure) => loadFailed(failure.message)));

        const outputs = yield* Effect.filter(written, (file) =>
          fs.stat(path.join(out, file)).pipe(
            Effect.map(({ type }) => type === "File"),
            Effect.orElseSucceed(() => false)
          )
        );

        if (!entries.every((entry) => outputs.includes(bundledAs(entry)))) {
          return yield* loadFailed("bun wrote no bundle for an entry");
        }

        return yield* Effect.forEach(outputs, (output) =>
          fs.readFileString(path.join(out, output)).pipe(
            Effect.map(
              (content) => [owners.get(output) ?? output, content] as const
            ),
            Effect.mapError((failure) => loadFailed(failure.message))
          )
        );
      });

    return ConfigBundler.of({
      bundle: (files) =>
        Effect.scoped(
          Effect.gen(function* () {
            const entries = entriesOf(files.map(({ path: file }) => file));

            const data = files
              .filter(({ path: file }) => !SCRIPT.test(file))
              .map(({ content, path: file }) => [file, content] as const);

            const dir = yield* fs
              .makeTempDirectoryScoped({ prefix: "config-bundle-" })
              .pipe(Effect.mapError((failure) => loadFailed(failure.message)));

            const code =
              entries.length === 0 ? [] : yield* build(dir, files, entries);

            return {
              entry: configEntry,
              modules: Object.fromEntries([...data, ...code]),
              sdkVersion,
            } satisfies ConfigBundle;
          })
        ),
    });
  })
);

/** What the policy is evaluated for, which the repo cannot say. */
export interface PolicyAbout {
  /** The project the asks belong to. */
  readonly project: ProjectName;
  /** Who `owners` names; locally, the person checking, as no stage of a push reads it. */
  readonly initializer: Handle;
}

/** One file of a commit, as `git ls-tree -r -l` lists it. */
interface TreeFile {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

const ENTRY =
  /^(?<mode>\d+) (?<type>\w+) (?<sha>[0-9a-f]+) +(?<size>-|\d+)\t(?<path>.+)$/su;

/** Every blob in the commit `sha`'s tree, in git's order. */
const filesAt = (root: string, sha: CommitSha) =>
  Effect.map(
    runGit(root, ["ls-tree", "-r", "-l", "-z", "--full-tree", sha]),
    ({ stdout }) =>
      stdout.split("\0").flatMap((record): readonly TreeFile[] => {
        const groups = ENTRY.exec(record)?.groups;

        return groups?.type === "blob" &&
          groups.sha !== undefined &&
          groups.path !== undefined
          ? [
              {
                path: groups.path,
                sha: groups.sha,
                size: Math.trunc(Number(groups.size ?? "0")),
              },
            ]
          : [];
      })
  );

/** A blob's text. */
const textOf = (root: string, file: TreeFile) =>
  Effect.map(runGit(root, ["cat-file", "blob", file.sha]), ({ stdout }) => ({
    content: stdout,
    path: RepoPath.make(file.path),
  }));

// The platform's facts at a landing (`@repo/project`'s `evaluationFacts`):
// the folders whose files the run-block finder reads, and how large a file
// it reads at most.
const CI_FOLDERS = [".github/workflows", ".forgejo/workflows", ".husky"];

const MAX_FACT_BYTES = 256 * 1024;

const folderOf = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** The files directly in `folder` (`""` is the root), small enough to read. */
const filesIn = (files: readonly TreeFile[], folder: string) =>
  files.filter(
    ({ path, size }) => folderOf(path) === folder && size <= MAX_FACT_BYTES
  );

/** The folders directly in `folder`, in git's order. */
const foldersIn = (files: readonly TreeFile[], folder: string) => {
  const prefix = folder === "" ? "" : `${folder}/`;

  return Array.dedupe(
    files.flatMap(({ path }) => {
      if (!path.startsWith(prefix)) {
        return [];
      }

      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");

      return slash === -1 ? [] : [`${prefix}${rest.slice(0, slash)}`];
    })
  );
};

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

/**
 * The folders a workspace glob names: `packages/*` is every folder in
 * `packages`, and a glob with no `*` is its own folder. Deeper globs are
 * read as their folder prefix's children, as the platform reads them.
 */
const foldersOf = (files: readonly TreeFile[], glob: string) => {
  const clean = withoutDotSlash(glob).replace(/\/+$/u, "");
  const star = clean.indexOf("*");

  return star === -1
    ? [clean]
    : foldersIn(files, clean.slice(0, star).replace(/\/+$/u, ""));
};

/** The facts the platform evaluates the config folder over, read at `sha`. */
const factsAt = (input: {
  readonly root: string;
  readonly sha: CommitSha;
  readonly files: readonly TreeFile[];
  readonly about: PolicyAbout;
  readonly vouchFile: string;
}) =>
  Effect.gen(function* () {
    const { about, files, root, sha } = input;

    const read = (each: readonly TreeFile[]) =>
      Effect.forEach(each, (file) => textOf(root, file), { concurrency: 8 });

    const atRoot = yield* read(filesIn(files, ""));

    const ci = [
      ...atRoot,
      ...(yield* read(CI_FOLDERS.flatMap((folder) => filesIn(files, folder)))),
    ];

    const globs = Option.match(
      Option.flatMap(
        Option.fromUndefinedOr(
          atRoot.find(({ path }) => path === "package.json")
        ),
        ({ content }) => decodeManifest(content)
      ),
      {
        onNone: () => [],
        onSome: (manifest) => workspaceGlobs(manifest.workspaces),
      }
    );

    const dirs = Array.dedupe(globs.flatMap((glob) => foldersOf(files, glob)));

    const workspaces = Array.getSomes(
      yield* Effect.forEach(dirs, (dir) =>
        Option.match(
          Option.fromUndefinedOr(
            filesIn(files, dir).find(
              ({ path }) => path === `${dir}/package.json`
            )
          ),
          {
            onNone: () => Effect.succeedNone,
            onSome: (file) =>
              Effect.map(textOf(root, file), ({ content }) =>
                Option.flatMap(decodeManifest(content), (manifest) =>
                  manifest.name === undefined || manifest.name.length === 0
                    ? Option.none()
                    : Option.some({
                        dir,
                        exports: exportTargets(manifest.exports).map((target) =>
                          RepoPath.make(`${dir}/${withoutDotSlash(target)}`)
                        ),
                        name: manifest.name,
                      })
                )
              ),
          }
        )
      )
    );

    const vouch = yield* Option.match(
      Option.fromUndefinedOr(
        files.find(({ path }) => path === input.vouchFile)
      ),
      {
        onNone: () => Effect.succeedNone,
        onSome: (file) => Effect.asSome(textOf(root, file)),
      }
    );

    // The commit's own time and first eight hex digits: the same commit
    // always sees the same clock and randomness.
    const seconds = yield* runGit(root, ["show", "-s", "--format=%ct", sha]);

    const now = yield* Effect.fromOption(
      DateTime.make(Math.trunc(Number(seconds.stdout.trim())) * 1000)
    ).pipe(Effect.mapError(() => loadFailed(`${sha} has no commit time`)));

    const facts: EvaluationFacts = {
      ci,
      initializer: about.initializer,
      now,
      project: about.project,
      seed: Number.parseInt(sha.slice(0, 8), 16),
      workspaces,
    };

    return Option.match(vouch, {
      onNone: () => facts,
      onSome: ({ content }) => ({ ...facts, vouchFile: content }),
    });
  });

/** The finishers the platform passes the rules evaluator: `@repo/checks`' own. */
const finishers = Layer.succeed(Finishers)({ findRunBlock, judgeClosure });

/** Where a policy that names none keeps its vouch file. */
const defaultVouchFile = `${Brand.configDir}/vouched.td`;

/**
 * The policy at `base` in the repo at `root`, never HEAD's: the config
 * folder's TypeScript (bundled by `ConfigBundler`, run by the `/bun`
 * evaluator), else its `policy.json` (`/json`), else the defaults (no
 * folder), finished with `@repo/checks`' finder and judge closure. A policy
 * that keeps its vouch file elsewhere is read again with that file.
 */
export const localPolicy = (
  root: string,
  base: string,
  about: PolicyAbout
): Effect.Effect<
  Policy,
  RulesFailed,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ConfigBundler
> =>
  Effect.gen(function* () {
    const sha = yield* commitOf(root, base).pipe(
      Effect.mapError((failure) => loadFailed(failure.message))
    );

    const files = yield* filesAt(root, sha);

    const config = files.filter(({ path }) =>
      path.startsWith(`${Brand.configDir}/`)
    );

    const entries = entriesOf(config.map(({ path }) => path));

    const modules: ConfigBundle =
      entries.length === 0
        ? {
            entry: configEntry,
            modules: Object.fromEntries(
              (yield* Effect.forEach(
                config.filter(({ path }) => !SCRIPT.test(path)),
                (file) => textOf(root, file)
              )).map(({ content, path }) => [path, content])
            ),
            sdkVersion,
          }
        : yield* Effect.flatMap(
            Effect.forEach(config, (file) => textOf(root, file)),
            (all) => ConfigBundler.use((bundler) => bundler.bundle(all))
          );

    const evaluator =
      entries.length === 0
        ? RulesEvaluatorJson.pipe(Layer.provide(finishers))
        : rulesEvaluatorBun().pipe(Layer.provide(finishers));

    const at = LandedSha.make(sha);

    const evaluate = (vouchFile: string) =>
      Effect.flatMap(factsAt({ about, files, root, sha, vouchFile }), (facts) =>
        RulesEvaluator.use((rules) => rules.evaluate({ at, facts, modules }))
      ).pipe(Effect.provide(evaluator));

    const first = yield* evaluate(defaultVouchFile);

    return first.vouch.file === defaultVouchFile
      ? first
      : yield* evaluate(first.vouch.file);
  }).pipe(
    Effect.catchTag("NotARepo", (failure) =>
      Effect.fail(loadFailed(failure.message))
    )
  );
