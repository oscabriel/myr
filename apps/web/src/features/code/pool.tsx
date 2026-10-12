import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { use, useMemo } from "react";

import { diffsOptions, registerCodeTheme } from "./pierre.ts";

const POOL_SIZE = 2;

export const workerPool = () => {
  registerCodeTheme();

  return getOrCreateWorkerPoolSingleton({
    highlighterOptions: {
      lineDiffType: "word-line",
      maxLineDiffLength: diffsOptions.maxLineDiffLength,
      preferredHighlighter: diffsOptions.preferredHighlighter,
      theme: diffsOptions.theme,
      tokenizeMaxLineLength: diffsOptions.tokenizeMaxLineLength,
    },
    poolOptions: {
      onWorkerError: () => {
        // Pierre replaces a failed worker; its code stays as the page's plain text.
      },
      poolSize: POOL_SIZE,
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
    },
  });
};

type Pool = ReturnType<typeof workerPool>;

/** One promise per pool, so `use` sees the same one on every render. */
const readiness = new WeakMap<Pool, Promise<void>>();

/**
 * Before the pool's highlighter is up, Pierre draws a file it would not
 * highlight as nothing, and never draws it again.
 */
const readyOf = (pool: Pool) => {
  const known = readiness.get(pool);

  if (known !== undefined) {
    return known;
  }

  // Marked settled the way React reads a promise it has seen, so `use` does not
  // hold the drawing back for a turn.
  const made = pool.isInitialized()
    ? Object.assign(Promise.resolve(), { status: "fulfilled" })
    : Effect.runPromise(
        Effect.ignore(Effect.tryPromise(() => pool.initialize()))
      );

  Effect.runFork(
    Effect.promise(() => made).pipe(
      Effect.map(() => Object.assign(made, { status: "fulfilled" }))
    )
  );
  readiness.set(pool, made);

  return made;
};

export const poolReady = () =>
  "Worker" in globalThis ? readyOf(workerPool()) : Promise.resolve();

export const CodePool = ({ children }: { readonly children: ReactNode }) => {
  const pool = useMemo(
    () => ("Worker" in globalThis ? workerPool() : undefined),
    []
  );

  if (pool !== undefined) {
    use(readyOf(pool));
  }

  return <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>;
};
