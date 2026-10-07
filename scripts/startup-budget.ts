/**
 * bytes:check: builds each Worker as a deploy would (`wrangler deploy
 * --dry-run`) and fails when its bundle passes the byte limits. The limits are
 * Rat Stack's, set just above its own minified Worker (an 822,362-byte entry
 * and 2,205,180 bytes of JavaScript): regression alarms, not Cloudflare's
 * upload limit. Startup time is evidence, not a gate; profile it with
 * `wrangler check startup` in the Worker's folder.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, Path, pipe } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const entryBudget = 900_000;

const javascriptBudget = 2_500_000;

/** Each Worker, and the file its `main` bundles to. */
const workers = [
  { dir: "apps/platform", entry: "worker.js" },
  { dir: "apps/sandbox", entry: "worker.js" },
] as const;

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

const measure = Effect.fnUntraced(function* (worker: (typeof workers)[number]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const outdir = yield* fs.makeTempDirectoryScoped();

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(
      path.resolve(worker.dir, "node_modules/.bin/wrangler"),
      ["deploy", "--dry-run", "--outdir", outdir],
      {
        cwd: worker.dir,
        env: { WRANGLER_LOG: "error", WRANGLER_SEND_METRICS: "false" },
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

BunRuntime.runMain(
  Effect.forEach(workers, measure, { discard: true }).pipe(
    Effect.provide(BunServices.layer)
  )
);
