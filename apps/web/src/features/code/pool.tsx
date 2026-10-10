/**
 * Highlighting off the main thread: Pierre's worker pool, which every
 * drawing of code under `CodePool` shares (`File`, `CodeView`). The pool is
 * made once for the tab, the first time a page draws code, and kept: the
 * next code page highlights in workers already warm, and a file drawn once
 * is not highlighted again (each drawing keys its file by blob id).
 *
 * The worker is Pierre's own module, bundled by Vite as a module worker.
 * Only the browser loads this file (through the lazy drawings).
 */
import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { use, useMemo } from "react";

import { diffsOptions, registerCodeTheme } from "./pierre.ts";

/** Two workers: a page draws one file or one diff at a time, and grammars load once per worker. */
const POOL_SIZE = 2;

/** The tab's pool: made the first time code is drawn or warmed, the same after. */
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
        // A worker that fails is Pierre's to replace; the code it was
        // drawing stays as plain text, which is what the page sent.
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
 * Settles once the pool's own highlighter is up (or has failed, when
 * Pierre draws on the main thread instead). Before that, Pierre draws a
 * file it would not highlight (a `.vm`, plain text) as nothing, and never
 * draws it again.
 */
const readyOf = (pool: Pool) => {
  const known = readiness.get(pool);

  if (known !== undefined) {
    return known;
  }

  // A pool already up is marked settled the way React reads a promise it
  // has seen, so `use` does not hold the drawing back for a turn.
  const made = pool.isInitialized()
    ? Object.assign(Promise.resolve(), { status: "fulfilled" })
    : Effect.runPromise(
        Effect.ignore(Effect.tryPromise(() => pool.initialize()))
      );

  readiness.set(pool, made);

  return made;
};

/**
 * The pool, for the drawings under it; none outside a browser. Until the
 * pool is up the drawings wait in their `Suspense`, whose fallback is the
 * server's plain text.
 */
export const CodePool = ({ children }: { readonly children: ReactNode }) => {
  // Pierre keeps one pool for the tab: asking again hands back the same.
  const pool = useMemo(
    () => ("Worker" in globalThis ? workerPool() : undefined),
    []
  );

  if (pool !== undefined) {
    use(readyOf(pool));
  }

  return <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>;
};
