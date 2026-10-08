import {
  Config,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Stream,
} from "effect";
import type { Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  Collected,
  askModules,
  fromCollected,
  projectModule,
  statedWithoutCode,
} from "../config-folder.ts";
import { defaultPolicyInput } from "../defaults.ts";
import { Finishers, finishPolicy } from "../finish.ts";
import { factsOf, RulesEvaluator, RulesFailed } from "../rules-evaluator.ts";
import type { ConfigBundle } from "../rules-evaluator.ts";
import { bunMain } from "./bun-main.ts";
import { bunPrelude, clockVariable } from "./bun-prelude.ts";

/** How the `/bun` adapter runs config code. */
export interface BunOptions {
  /** The bun binary; `bun` on the `PATH` by default. */
  readonly bun?: string;
  /**
   * What the bun binary needs in its env beside `PATH` and the clock: a
   * compiled CLI runs itself as bun with `BUN_BE_BUN=1`. None by default.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * The module the main hands the exports to (`../entry.ts` here, or a
   * bundled copy of it on disk); this package's own by default.
   */
  readonly entry?: string;
  /** The module the sdk's imports point at; `@repo/sdk`'s entry by default. */
  readonly sdk?: string;
  /** How long config code may run; 5 seconds by default. */
  readonly timeout?: Duration.Input;
}

// An import or export of the sdk by either of its names: the workspace one,
// and the published one, `<npm scope>/cli/rules`. The published name is
// matched by its shape, so `rules` never spells the brand; a config folder
// can import nothing else by a bare name anyway.
const SDK_IMPORT =
  /(?<lead>\bfrom\s*|\bimport\s*\(?\s*)(?<quote>["'])(?:@repo\/sdk|@[a-z0-9][\w.-]*\/cli\/rules)\k<quote>/gu;

/** Points every import of the sdk, by either name, at the module `sdk`. */
const pointSdkAt = (source: string, sdk: string) =>
  source.replaceAll(SDK_IMPORT, `$<lead>${JSON.stringify(sdk)}`);

/** What the subprocess prints as its last line. */
const Output = Schema.TaggedUnion({
  Called: { result: Schema.Json },
  Collected: Collected.fields,
  Failed: {
    detail: Schema.String,
    reason: Schema.Literals(["load", "threw"]),
  },
});

type Output = typeof Output.Type;

const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(Output));

/** A module the main imports: where it was written, and its path in the bundle. */
interface Written {
  readonly file: string;
  readonly path: string;
}

/** What the main is asked to do: collect the folder's exports, or call a rule. */
interface Job {
  readonly asks: readonly Written[];
  readonly entry: string;
  readonly facts?: Schema.Json;
  readonly project?: Written;
  readonly rule?: string;
}

/** The frozen clock and seed the prelude installs. */
interface Clock {
  readonly now: string;
  readonly seed: number;
}

// Where the clock stands for a call: rule functions get time only through
// the facts they are called with.
const epoch: Clock = { now: "1970-01-01T00:00:00.000Z", seed: 0 };

const loadFailed = (detail: string) =>
  new RulesFailed({ detail, reason: "load" });

const surprised = (output: Output) =>
  new RulesFailed({
    detail: `the evaluator answered ${output._tag} to a job it was not given`,
    reason: "decode",
  });

const fromFailed = ({ detail, reason }: Extract<Output, { _tag: "Failed" }>) =>
  new RulesFailed({ detail, reason });

// The most of the subprocess's output the host keeps, from the end: config
// code may print without end, the result is stdout's last line, and what
// broke is told at the end of stderr.
const resultLimit = 16 * 1024 * 1024;

const logLimit = 64 * 1024;

/** The last `limit` characters a stream prints; the rest is read and dropped. */
const tailOf = <E>(bytes: Stream.Stream<Uint8Array, E>, limit: number) =>
  bytes.pipe(
    Stream.decodeText(),
    // Cut at twice the limit, so each character is copied only a few times.
    Stream.runFold(
      () => "",
      (kept: string, chunk: string) =>
        kept.length + chunk.length > 2 * limit
          ? `${kept}${chunk}`.slice(-limit)
          : `${kept}${chunk}`
    ),
    Effect.map((kept) => kept.slice(-limit))
  );

/** The project module and ask files, as the main imports them. */
const modulesOf = (
  written: ReadonlyMap<string, string>,
  project: string | undefined,
  asks: readonly string[]
) => {
  const at = (file: string): Written => ({
    file: written.get(file) ?? file,
    path: file,
  });

  const asksWritten = asks.map(at);

  return project === undefined
    ? { asks: asksWritten }
    : { asks: asksWritten, project: at(project) };
};

/**
 * `RulesEvaluator` over a `bun` subprocess. Each evaluation writes the
 * bundle's modules into a scoped temp directory (every import of the sdk
 * pointed at the sdk's own entry), runs `bun --preload <prelude> <main>`
 * with no inherited env beyond `PATH`, frozen time and randomness, and a
 * time limit, and reads one JSON document from its stdout. A bundle with no
 * project module and no asks reads `policy.json`, or gets the defaults,
 * without a subprocess. Then `finishPolicy`, with the caller's `Finishers`.
 */
export const rulesEvaluatorBun = (options: BunOptions = {}) =>
  Layer.effect(
    RulesEvaluator,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const finishers = yield* Finishers;
      const bun = options.bun ?? "bun";
      const timeout = Duration.fromInputUnsafe(options.timeout ?? "5 seconds");

      const searchPath = yield* Effect.orDie(
        Config.String("PATH").pipe(
          Config.withDefault("/usr/local/bin:/usr/bin:/bin")
        )
      );

      const fromUrl = (url: string) =>
        Effect.orDie(path.fromFileUrl(new URL(url)));

      const entry =
        options.entry ?? (yield* fromUrl(import.meta.resolve("../entry.ts")));

      const sdk =
        options.sdk ?? (yield* fromUrl(import.meta.resolve("@repo/sdk")));

      /** Writes `source` at `file` under `root`, refusing a path that leaves it. */
      const writeUnder = (root: string, file: string, source: string) => {
        const target = path.join(root, file);
        const relative = path.relative(root, target);

        if (
          relative === "" ||
          relative.startsWith("..") ||
          path.isAbsolute(relative)
        ) {
          return Effect.fail(
            loadFailed(`${file}: not a path inside the config folder`)
          );
        }

        return fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(target, source)),
          Effect.as(target),
          Effect.mapError((failure) =>
            loadFailed(`${file}: ${failure.message}`)
          )
        );
      };

      /** Runs the main over the bundle for one job, and reads its result. */
      const run = (
        bundle: ConfigBundle,
        clock: Clock,
        job: (written: ReadonlyMap<string, string>) => Omit<Job, "entry">
      ): Effect.Effect<Output, RulesFailed, Scope.Scope> =>
        Effect.gen(function* () {
          const dir = yield* fs
            .makeTempDirectoryScoped({ prefix: "rules-" })
            .pipe(Effect.mapError((failure) => loadFailed(failure.message)));

          const root = path.join(dir, "config");
          const written = new Map<string, string>();

          for (const [file, source] of Object.entries(bundle.modules)) {
            written.set(
              file,
              yield* writeUnder(root, file, pointSdkAt(source, sdk))
            );
          }

          const request: Job = { ...job(written), entry };

          yield* writeUnder(dir, "job.json", JSON.stringify(request));
          yield* writeUnder(dir, "main.mjs", bunMain);
          yield* writeUnder(dir, "prelude.mjs", bunPrelude);

          // Details name the bundle's paths, not where they were written.
          const clean = (detail: string) =>
            detail.replaceAll(`${root}/`, "").trim();

          const command = ChildProcess.make(
            bun,
            [
              "--preload",
              path.join(dir, "prelude.mjs"),
              path.join(dir, "main.mjs"),
            ],
            {
              cwd: dir,
              env: {
                ...options.env,
                [clockVariable]: JSON.stringify(clock),
                PATH: searchPath,
              },
              extendEnv: false,
              forceKillAfter: "1 second",
            }
          );

          const child = yield* spawner
            .spawn(command)
            .pipe(
              Effect.mapError((failure) =>
                loadFailed(`could not start ${bun}: ${failure.message}`)
              )
            );

          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              tailOf(child.stdout, resultLimit),
              tailOf(child.stderr, logLimit),
              child.exitCode,
            ],
            { concurrency: "unbounded" }
          ).pipe(Effect.mapError((failure) => loadFailed(failure.message)));

          const last = stdout.trimEnd().split("\n").at(-1) ?? "";

          if (exitCode !== 0 || last === "") {
            return yield* loadFailed(
              clean(stderr) ||
                `${bun} exited with ${exitCode} and printed no result`
            );
          }

          const output = yield* decodeOutput(last).pipe(
            Effect.mapError(
              (failure) =>
                new RulesFailed({
                  detail: `the evaluator's result: ${failure.message}`,
                  reason: "decode",
                })
            )
          );

          return Schema.is(Output.cases.Failed)(output)
            ? { ...output, detail: clean(output.detail) }
            : output;
        });

      /** Runs a job in its own scope, within the time limit. */
      const limited = (
        effect: Effect.Effect<Output, RulesFailed, Scope.Scope>
      ) =>
        Effect.scoped(effect).pipe(
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new RulesFailed({
                  detail: `the config folder ran past its ${Duration.format(timeout)} limit`,
                  reason: "timeout",
                })
              ),
          })
        );

      return RulesEvaluator.of({
        call: (input) => {
          const { modules, rule } = input;
          const project = projectModule(modules);

          if (project === undefined) {
            return Effect.succeed(false);
          }

          return factsOf(input).pipe(
            Effect.flatMap((facts) =>
              limited(
                run(modules, epoch, (written) => ({
                  ...modulesOf(written, project, []),
                  facts,
                  rule,
                }))
              )
            ),
            Effect.flatMap(
              Output.match({
                Called: ({ result }) =>
                  Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
                    Effect.mapError(
                      (failure) =>
                        new RulesFailed({
                          detail: `${project}: ${rule} gave ${failure.message}`,
                          reason: "decode",
                        })
                    )
                  ),
                Collected: (output) => Effect.fail(surprised(output)),
                Failed: (output) => Effect.fail(fromFailed(output)),
              })
            )
          );
        },
        evaluate: ({ at, facts, modules }) =>
          Effect.gen(function* () {
            const project = projectModule(modules);
            const asks = askModules(modules);

            const clock: Clock = {
              now: DateTime.formatIso(facts.now),
              seed: facts.seed,
            };

            // Without a project module, `policy.json` (or the defaults) is the
            // base the ask files join; with one, it is never read.
            const fallback =
              project === undefined
                ? yield* statedWithoutCode(modules)
                : defaultPolicyInput;

            const policy =
              project === undefined && asks.length === 0
                ? fallback
                : yield* limited(
                    run(modules, clock, (written) =>
                      modulesOf(written, project, asks)
                    )
                  ).pipe(
                    Effect.flatMap(
                      Output.match({
                        Called: (output) => Effect.fail(surprised(output)),
                        Collected: (collected) =>
                          fromCollected({
                            collected,
                            entry: project ?? modules.entry,
                            fallback,
                            initializer: facts.initializer,
                          }),
                        Failed: (output) => Effect.fail(fromFailed(output)),
                      })
                    )
                  );

            return yield* finishPolicy({ at, facts, finishers, policy });
          }),
      });
    })
  );

/** The `/bun` adapter with its defaults: `bun` on the `PATH`, a 5-second limit. */
export const RulesEvaluatorBun = rulesEvaluatorBun();
