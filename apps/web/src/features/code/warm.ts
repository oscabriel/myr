import { diffsOptions } from "./pierre.ts";
import { workerPool } from "./pool.tsx";

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
