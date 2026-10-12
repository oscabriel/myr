/**
 * The server and the browser decide alike from the page's own data, so the
 * browser knows which code arrived highlighted without being told.
 */
import { getFiletypeFromFileName } from "@pierre/diffs";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { Effect, Option } from "effect";

import { drawnFiles } from "./diff-model.ts";
import type { DrawnFile } from "./diff-model.ts";
import { diffsOptions } from "./pierre.ts";

export const SERVER_LANGUAGES = [
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "toml",
  "tsx",
  "typescript",
  "yaml",
  "yml",
  "zsh",
] as const;

export type ServerLanguage = (typeof SERVER_LANGUAGES)[number];

/** Measured warm in workerd: 400 lines of TypeScript took about 57 ms. */
export const SERVER_LINES = 400;

export const SERVER_FILES = 8;

const isServerLanguage = (name: string): name is ServerLanguage =>
  SERVER_LANGUAGES.some((language) => language === name);

export const serverLanguageOf = (
  path: string
): Option.Option<ServerLanguage> => {
  const name = getFiletypeFromFileName(path);

  return isServerLanguage(name) ? Option.some(name) : Option.none();
};

const linesWithin = (text: string): Option.Option<number> => {
  const lines = text.split("\n");

  return lines.every(
    (line) => line.length <= diffsOptions.tokenizeMaxLineLength
  )
    ? Option.some(lines.length)
    : Option.none();
};

export const prerendersFile = (file: {
  readonly path: string;
  readonly text: string;
}) =>
  Option.isSome(serverLanguageOf(file.path)) &&
  file.text.length <= diffsOptions.tokenizeMaxLength &&
  Option.exists(linesWithin(file.text), (lines) => lines <= SERVER_LINES);

const diffLines = (drawn: DrawnFile): Option.Option<number> => {
  const sides = [drawn.file.oldText, drawn.file.newText].flatMap((text) =>
    text === undefined ? [] : [linesWithin(text)]
  );

  return Option.all(sides).pipe(
    Option.map((counts) => counts.reduce((sum, count) => sum + count, 0))
  );
};

export const prerenderedPaths = (
  drawn: readonly DrawnFile[]
): ReadonlySet<string> => {
  const paths = new Set<string>();
  let spent = 0;

  const open = drawn
    .filter((file) => !file.folded && Option.isSome(file.diff))
    .slice(0, SERVER_FILES);

  for (const file of open) {
    const lines = diffLines(file);

    if (
      Option.isSome(serverLanguageOf(file.file.path)) &&
      Option.isSome(lines) &&
      spent + lines.value <= SERVER_LINES
    ) {
      spent += lines.value;
      paths.add(file.file.path);
    }
  }

  return paths;
};

/** Settled ones say so, so a render never waits on them. */
type Drawing = Promise<string | undefined> & {
  status?: "fulfilled";
  value?: string | undefined;
};

const KEPT = { count: 24, size: 8_000_000 } as const;

const kept = new Map<string, { readonly drawing: Drawing; size: number }>();

const sizeOf = () =>
  [...kept.values()].reduce((sum, entry) => sum + entry.size, 0);

const trim = () => {
  for (const id of kept.keys()) {
    if (kept.size <= KEPT.count && sizeOf() <= KEPT.size) {
      return;
    }

    kept.delete(id);
  }
};

const keptDrawing = <E>(
  id: string,
  make: Effect.Effect<string | undefined, E>
): Drawing => {
  const known = kept.get(id);

  if (known !== undefined) {
    kept.delete(id);
    kept.set(id, known);

    return known.drawing;
  }

  const drawing: Drawing = Effect.runPromise(
    make.pipe(Effect.orElseSucceed((): string | undefined => undefined))
  );

  const entry = { drawing, size: 0 };

  kept.set(id, entry);
  // Subscribed first, so whoever awaits it next finds it marked.
  Effect.runFork(
    Effect.promise(() => drawing).pipe(
      Effect.andThen((html) =>
        Effect.sync(() => {
          drawing.status = "fulfilled";
          drawing.value = html;
          entry.size = html?.length ?? 0;
          trim();
        })
      )
    )
  );
  trim();

  return drawing;
};

/**
 * `import.meta.env.SSR` is false in the browser's build, so this import is dead
 * code there.
 */
const server = () =>
  import.meta.env.SSR
    ? Effect.tryPromise(() => import("./prerender-server.ts"))
    : Effect.die("Only the server draws code ahead");

export const fileDrawingId = (file: {
  readonly path: string;
  readonly sha: string;
}) => `file:${file.sha}:${file.path}`;

export const diffDrawingId = (drawn: DrawnFile) =>
  `${drawn.file.before ?? "none"}:${drawn.file.after ?? "none"}:${drawn.file.path}`;

export const fileDrawing = (file: {
  readonly path: string;
  readonly sha: string;
  readonly text: string;
}) =>
  keptDrawing(
    fileDrawingId(file),
    server().pipe(Effect.andThen(({ prerenderFile }) => prerenderFile(file)))
  );

export const diffDrawing = (drawn: DrawnFile) =>
  keptDrawing(
    diffDrawingId(drawn),
    server().pipe(Effect.andThen(({ prerenderDiff }) => prerenderDiff(drawn)))
  );

export const drawFileAhead = ({
  path,
  sha,
  text,
}: {
  readonly path: string;
  readonly sha: string;
  readonly text?: string | undefined;
}) =>
  Effect.runPromise(
    text === undefined || !prerendersFile({ path, text })
      ? Effect.void
      : Effect.promise(() => fileDrawing({ path, sha, text })).pipe(
          Effect.asVoid
        )
  );

export const drawDiffAhead = (files: readonly ChangedFile[]) => {
  const drawn = drawnFiles(files);
  const paths = prerenderedPaths(drawn);

  return Effect.runPromise(
    Effect.forEach(
      drawn.filter((file) => paths.has(file.file.path)),
      (file) => Effect.promise(() => diffDrawing(file)),
      { concurrency: "unbounded", discard: true }
    )
  );
};
