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
import type { ReactNode } from "react";
import { useMemo } from "react";

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

/** The pool, for the drawings under it; none outside a browser. */
export const CodePool = ({ children }: { readonly children: ReactNode }) => {
  // Pierre keeps one pool for the tab: asking again hands back the same.
  const pool = useMemo(
    () => ("Worker" in globalThis ? workerPool() : undefined),
    []
  );

  return <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>;
};
