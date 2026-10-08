/**
 * bytes:check: builds each Worker as a deploy would (`wrangler deploy
 * --dry-run`) and fails when its bundle passes the byte limits: regression
 * alarms, not Cloudflare's upload limit. Startup time is evidence, not a
 * gate; profile it with `wrangler check startup` in the Worker's folder.
 *
 * The first limits were Rat Stack's (900,000 entry bytes for its 822,362-byte
 * Worker). The platform Worker outgrew them in W3 by carrying more surfaces:
 * 1,513,671 entry bytes once W3 was whole, of which Effect is about 813,000,
 * the OAuth provider 114,000, isomorphic-git and pako 141,000 (the binding's
 * smart-HTTP pushes) and yaml 103,000 (the run-block finder, at each policy
 * refresh). Its startup is 116 to 171 ms live, far under Cloudflare's 1 s
 * limit. The entry limit sits about 10% above that entry, as an alarm for
 * growth. A dynamic `import()` does not shrink the entry: Wrangler's esbuild
 * build has no code splitting and inlines it (checked in W3 399), so moving
 * a dependency off the entry takes a module of its own (`find_additional_modules`)
 * or a Worker of its own.
 *
 * The web Worker is built by Vite first (`vite build`, through the
 * Cloudflare plugin, which writes the deploy config under `dist/`); its dry
 * run then bundles nothing more and copies Vite's modules. Its first
 * measurement (W5 501) was an entry of 723,418 bytes, unminified, under the
 * same limits.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, Path, pipe } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const entryBudget = 1_665_000;

const javascriptBudget = 2_500_000;

/**
 * Each Worker, the file its `main` bundles to, and the build a dry run needs
 * first, if any: a command in the Worker's own `node_modules/.bin`.
 */
export const workers: readonly Worker[] = [
  { dir: "apps/platform", entry: "worker.js" },
  { dir: "apps/sandbox", entry: "worker.js" },
  { build: ["vite", "build"], dir: "apps/web", entry: "index.js" },
];

interface Worker {
  readonly dir: string;
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

/** Runs a Worker's build in its folder, from its own `node_modules/.bin`. */
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

  yield* Console.log(
    `bytes:check: ${worker.dir}: entry ${entry} of ${entryBudget}; JavaScript ${total} of ${javascriptBudget}`
  );

  if (entry > entryBudget) {
    return yield* new OverBudget({
      budget: entryBudget,
      bytes: entry,
      scope: "entry",
      worker: worker.dir,
    });
  }

  if (total > javascriptBudget) {
    return yield* new OverBudget({
      budget: javascriptBudget,
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
