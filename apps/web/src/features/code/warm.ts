/**
 * Highlighting a file before its page opens: when a pointer rests on a
 * link to a file, the router fetches the page's data ahead of the click
 * (its intent preload), and the file is then highlighted in the worker
 * pool, so the page draws it at once. Only a file under the highlighting
 * limit is warmed; past it the page draws plain text anyway. Loaded in the
 * browser only, on the first such hover.
 */
import { diffsOptions } from "./pierre.ts";
import { workerPool } from "./pool.tsx";

/**
 * Highlight `file` in the pool ahead of its page, keyed as the page will
 * draw it; settles once it has (at once for a file not warmed).
 */
export const warmFile = (file: {
  readonly path: string;
  readonly sha: string;
  readonly text?: string | undefined;
}): Promise<void> =>
  "Worker" in globalThis &&
  file.text !== undefined &&
  file.text.length <= diffsOptions.tokenizeMaxLength
    ? workerPool().primeFileHighlightCache({
        cacheKey: file.sha,
        contents: file.text,
        name: file.path,
      })
    : Promise.resolve();
