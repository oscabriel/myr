// The policy comes from the config at `main` (or `--base`), never the answer's own tree, as on the platform.
import { Brand } from "@repo/brand";
import { findRunBlock } from "@repo/checks/finder";
import { judgeClosure } from "@repo/checks/judge";
import { workspacesIn } from "@repo/checks/workspaces";
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
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ConfigRuntime } from "./config-runtime.ts";
import { commitOf, runGit } from "./facts.ts";
import { blobsAt, judgeFilesIn } from "./judge-files.ts";
import type { ListedBlob } from "./judge-files.ts";

export interface ConfigFile {
  readonly path: string;
  readonly content: string;
}

export class ConfigBundler extends Context.Service<
  ConfigBundler,
  {
    readonly bundle: (
      files: readonly ConfigFile[]
    ) => Effect.Effect<ConfigBundle, RulesFailed>;
  }
>()("cli/ConfigBundler") {}

const configEntry = `${Brand.configDir}/project.ts`;

// Code, which a bundle carries only inlined.
const SCRIPT = /\.[cm]?[jt]sx?$/u;

const ASK_FILE = /\.ask\.[cm]?[jt]s$/u;

const entriesOf = (paths: readonly string[]) =>
  paths.filter(
    (path) =>
      path === configEntry ||
      (path.startsWith(`${Brand.configDir}/asks/`) && ASK_FILE.test(path))
  );

const bundledAs = (entry: string) => entry.replace(/\.[^./]*$/u, ".js");

const loadFailed = (detail: string) =>
  new RulesFailed({ detail, reason: "load" });

export const ConfigBundlerBun: Layer.Layer<
  ConfigBundler,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Layer.effect(ConfigBundler)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

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
        const runtime = yield* ConfigRuntime;

        const { packages: beside, sdk } = yield* runtime.modules.pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path)
        );

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

        yield* Option.match(beside, {
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
                runtime.bun,
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
                { cwd: dir, env: runtime.env, extendEnv: true, stdin: "ignore" }
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

export interface PolicyAbout {
  readonly project: ProjectName;
  /** Locally, the person checking: no stage of a push reads it. */
  readonly initializer: Handle;
}

// A regular file, executable or not: the Lander bundles only these from the
// config folder, never a link or a submodule.
const FILE_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);

const textOf = (root: string, file: ListedBlob) =>
  Effect.map(runGit(root, ["cat-file", "blob", file.sha]), ({ stdout }) => ({
    content: stdout,
    path: RepoPath.make(file.path),
  }));

const factsAt = (input: {
  readonly root: string;
  readonly sha: CommitSha;
  readonly files: readonly ListedBlob[];
  readonly ci: EvaluationFacts["ci"];
  readonly about: PolicyAbout;
  readonly vouchFile: string;
}) =>
  Effect.gen(function* () {
    const { about, ci, files, root, sha } = input;

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
    const seconds = yield* runGit(root, [
      "show",
      "-s",
      "--no-show-signature",
      "--format=%ct",
      sha,
    ]);

    const now = yield* Effect.fromOption(
      DateTime.make(Math.trunc(Number(seconds.stdout.trim())) * 1000)
    ).pipe(Effect.mapError(() => loadFailed(`${sha} has no commit time`)));

    const facts: EvaluationFacts = {
      ci,
      initializer: about.initializer,
      now,
      project: about.project,
      seed: Number.parseInt(sha.slice(0, 8), 16),
      workspaces: workspacesIn(ci),
    };

    return Option.match(vouch, {
      onNone: () => facts,
      onSome: ({ content }) => ({ ...facts, vouchFile: content }),
    });
  });

const finishers = Layer.succeed(Finishers)({ findRunBlock, judgeClosure });

const defaultVouchFile = `${Brand.configDir}/vouched.td`;

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

    const files = yield* blobsAt(root, sha);

    const config = files.filter(
      ({ mode, path }) =>
        path.startsWith(`${Brand.configDir}/`) && FILE_MODES.has(mode)
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
        : Layer.unwrap(
            Effect.gen(function* () {
              const runtime = yield* ConfigRuntime;
              const unpacked = yield* runtime.modules;

              return rulesEvaluatorBun({
                bun: runtime.bun,
                env: runtime.env,
                sdk: unpacked.sdk,
                ...Option.match(unpacked.entry, {
                  onNone: () => ({}),
                  onSome: (entry) => ({ entry }),
                }),
              });
            })
          ).pipe(Layer.provide(finishers));

    const at = LandedSha.make(sha);
    const ci = yield* judgeFilesIn(root, files);

    const evaluate = (vouchFile: string) =>
      Effect.flatMap(
        factsAt({ about, ci, files, root, sha, vouchFile }),
        (facts) =>
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
