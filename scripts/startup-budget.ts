/**
 * The limits are regression alarms, not Cloudflare's upload limit. Each Worker
 * has its own, so one Worker's growth never hides in another's headroom.
 *
 * A dynamic `import()` does not shrink the entry: Wrangler's esbuild build has
 * no code splitting and inlines it, so moving a dependency off the entry takes
 * a module of its own (`find_additional_modules`) or a Worker of its own.
 *
 * The web's JavaScript counts the Worker's server modules only: chunks only
 * the browser loads are assets.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, Path, pipe } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

interface Budget {
  readonly entry: number;
  readonly javascript: number;
}

export const budgets = {
  "apps/platform": { entry: 1_900_000, javascript: 1_900_000 },
  "apps/sandbox": { entry: 656_000, javascript: 656_000 },
  "apps/web": { entry: 355_000, javascript: 3_191_000 },
} as const satisfies Record<string, Budget>;

export const workers: readonly Worker[] = [
  { dir: "apps/platform", entry: "worker.js" },
  { dir: "apps/sandbox", entry: "worker.js" },
  { build: ["vite", "build"], dir: "apps/web", entry: "index.js" },
];

interface Worker {
  readonly dir: keyof typeof budgets;
  readonly entry: string;
  readonly build?: readonly [string, ...string[]];
}

class BuildFailed extends Data.TaggedError("BuildFailed")<{
  readonly worker: string;
  readonly exitCode: number;
}> {}

class OverBudget extends Data.TaggedError("OverBudget")<{
  readonly worker: string;
  readonly scope: "entry" | "javascript";
  readonly bytes: number;
  readonly budget: number;
}> {}

const env = { WRANGLER_LOG: "error", WRANGLER_SEND_METRICS: "false" };

const runBuild = (
  dir: string,
  [command, ...args]: readonly [string, ...string[]]
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const exitCode = yield* spawner.exitCode(
      ChildProcess.make(path.resolve(dir, "node_modules/.bin", command), args, {
        cwd: dir,
        // A production build, whatever the shell says: the development
        // condition would measure the web's dev backend instead.
        env: { ...env, NODE_ENV: "production" },
        extendEnv: true,
        stderr: "inherit",
        stdout: "ignore",
      })
    );

    return exitCode === 0
      ? undefined
      : yield* new BuildFailed({ exitCode, worker: dir });
  });

const measure = Effect.fnUntraced(function* (worker: Worker) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const outdir = yield* fs.makeTempDirectoryScoped();

  if (worker.build !== undefined) {
    yield* runBuild(worker.dir, worker.build);
  }

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(
      path.resolve(worker.dir, "node_modules/.bin/wrangler"),
      ["deploy", "--dry-run", "--outdir", outdir],
      {
        cwd: worker.dir,
        env,
        extendEnv: true,
        stderr: "inherit",
        stdout: "ignore",
      }
    )
  );

  if (exitCode !== 0) {
    return yield* new BuildFailed({ exitCode, worker: worker.dir });
  }

  const javascript = (yield* fs.readDirectory(outdir, { recursive: true }))
    .filter((file) => file.endsWith(".js"))
    .toSorted();

  const sizes = yield* pipe(
    javascript,
    Effect.forEach((file) =>
      fs
        .readFile(path.join(outdir, file))
        .pipe(Effect.map((bytes) => ({ bytes: bytes.length, file })))
    )
  );

  const entry = sizes.find(({ file }) => file === worker.entry)?.bytes ?? 0;
  const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
  const budget: Budget = budgets[worker.dir];

  yield* Console.log(
    `bytes:check: ${worker.dir}: entry ${entry} of ${budget.entry}; JavaScript ${total} of ${budget.javascript}`
  );

  if (entry > budget.entry) {
    return yield* new OverBudget({
      budget: budget.entry,
      bytes: entry,
      scope: "entry",
      worker: worker.dir,
    });
  }

  if (total > budget.javascript) {
    return yield* new OverBudget({
      budget: budget.javascript,
      bytes: total,
      scope: "javascript",
      worker: worker.dir,
    });
  }

  return { entry, total };
}, Effect.scoped);

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.forEach(workers, measure, { discard: true }).pipe(
      Effect.provide(BunServices.layer)
    )
  );
}
