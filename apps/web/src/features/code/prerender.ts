/**
 * Which code the server sends highlighted, and where its drawing waits
 * between the page's loader and its render.
 *
 * The server highlights a fixed set of languages (`SERVER_LANGUAGES`, the
 * grammars the Worker bundles) and only within its own limit, far below
 * the browser's: a page highlights at most `SERVER_LINES` lines of text
 * (a diff counts both sides, as Pierre highlights both whole files), and
 * no line longer than the drawing's own line limit, so a minified file is
 * never tokenized on the server. Anything else is sent as plain text, as
 * before, and the browser highlights it.
 *
 * Both sides decide alike from the page's own data, so the browser knows
 * which code arrived highlighted without being told.
 *
 * The drawing is made once per (blob, path) or (both blobs, path), so it
 * is kept here, keyed by those ids, which never change what they name: the
 * loader starts it and waits for it, and the render reads it at once. A
 * few are kept, within a byte budget, so a file read again is not drawn
 * again. Nothing here runs in the browser but the decision.
 */
import { getFiletypeFromFileName } from "@pierre/diffs";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { Effect, Option } from "effect";

import { drawnFiles } from "./diff-model.ts";
import type { DrawnFile } from "./diff-model.ts";
import { diffsOptions } from "./pierre.ts";

/** The languages the Worker bundles a grammar for, by the names Pierre gives a file's type. */
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

/**
 * The most lines the server highlights for one page. Measured in the dev
 * world's workerd (ADR 0027), warm: 2,400 lines of TypeScript took about
 * 315 ms, 600 about 85 ms and 400 about 57 ms, so a page spends at most
 * some 60 ms highlighting, and a longer file is sent plain.
 */
export const SERVER_LINES = 400;

/** The most files of a diff the server highlights: those a reader sees first. */
export const SERVER_FILES = 8;

const isServerLanguage = (name: string): name is ServerLanguage =>
  SERVER_LANGUAGES.some((language) => language === name);

/** The language the server highlights `path` in, if it highlights it at all. */
export const serverLanguageOf = (
  path: string
): Option.Option<ServerLanguage> => {
  const name = getFiletypeFromFileName(path);

  return isServerLanguage(name) ? Option.some(name) : Option.none();
};

/** `text`'s lines, or none when one is longer than the drawing tokenizes. */
const linesWithin = (text: string): Option.Option<number> => {
  const lines = text.split("\n");

  return lines.every(
    (line) => line.length <= diffsOptions.tokenizeMaxLineLength
  )
    ? Option.some(lines.length)
    : Option.none();
};

/** Whether the server sends this file highlighted. */
export const prerendersFile = (file: {
  readonly path: string;
  readonly text: string;
}) =>
  Option.isSome(serverLanguageOf(file.path)) &&
  file.text.length <= diffsOptions.tokenizeMaxLength &&
  Option.exists(linesWithin(file.text), (lines) => lines <= SERVER_LINES);

/** A diff's lines on both sides, or none when a side has a line too long. */
const diffLines = (drawn: DrawnFile): Option.Option<number> => {
  const sides = [drawn.file.oldText, drawn.file.newText].flatMap((text) =>
    text === undefined ? [] : [linesWithin(text)]
  );

  return Option.all(sides).pipe(
    Option.map((counts) => counts.reduce((sum, count) => sum + count, 0))
  );
};

/**
 * The paths of a diff the server sends highlighted, unified: among the
 * first `SERVER_FILES` files that start open and have lines, those in a
 * server language, within `SERVER_LINES` together.
 */
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

/** A drawing as React's `use` reads it: settled ones say so, so a render never waits on them. */
type Drawing = Promise<string | undefined> & {
  status?: "fulfilled";
  value?: string | undefined;
};

/** How many drawings are kept, and how many characters of HTML at most. */
const KEPT = { count: 24, size: 8_000_000 } as const;

/** The drawings made, the oldest first; each id names what it draws for good. */
const kept = new Map<string, { readonly drawing: Drawing; size: number }>();

const sizeOf = () =>
  [...kept.values()].reduce((sum, entry) => sum + entry.size, 0);

/** Drops the oldest drawings past the count or the size. */
const trim = () => {
  for (const id of kept.keys()) {
    if (kept.size <= KEPT.count && sizeOf() <= KEPT.size) {
      return;
    }

    kept.delete(id);
  }
};

/** The drawing `id` names: the one kept, or one `make` starts now. */
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

  // A drawing that fails is none: the page sends the plain text instead.
  const drawing: Drawing = Effect.runPromise(
    make.pipe(Effect.orElseSucceed((): string | undefined => undefined))
  );

  const entry = { drawing, size: 0 };

  kept.set(id, entry);
  // Settled, it says so (`use` then reads it without waiting) and counts
  // its size. Subscribed first, so whoever awaits it next finds it marked.
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
 * The server's drawing module, on its first use. The browser's build has
 * none (`import.meta.env.SSR` is false there, so the import is dead code),
 * and draws nothing here.
 */
const server = () =>
  import.meta.env.SSR
    ? Effect.tryPromise(() => import("./prerender-server.ts"))
    : Effect.die("Only the server draws code ahead");

/** The id a file's drawing is kept by: its blob and its path (which names its language). */
export const fileDrawingId = (file: {
  readonly path: string;
  readonly sha: string;
}) => `file:${file.sha}:${file.path}`;

/** The id a diff's drawing is kept by: both its blobs and its path. */
export const diffDrawingId = (drawn: DrawnFile) =>
  `${drawn.file.before ?? "none"}:${drawn.file.after ?? "none"}:${drawn.file.path}`;

/** A file highlighted by the server, as the HTML of its shadow root; none if it could not be. */
export const fileDrawing = (file: {
  readonly path: string;
  readonly sha: string;
  readonly text: string;
}) =>
  keptDrawing(
    fileDrawingId(file),
    server().pipe(Effect.andThen(({ prerenderFile }) => prerenderFile(file)))
  );

/** A diff's file highlighted by the server, unified, as the HTML of its shadow root. */
export const diffDrawing = (drawn: DrawnFile) =>
  keptDrawing(
    diffDrawingId(drawn),
    server().pipe(Effect.andThen(({ prerenderDiff }) => prerenderDiff(drawn)))
  );

/**
 * A page's file highlighted ahead of its render, which then finds it
 * drawn and waits for nothing; nothing to do for a file sent plain.
 */
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

/** A diff's first files highlighted ahead of its render, as `drawFileAhead`. */
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
