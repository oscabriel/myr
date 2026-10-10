/**
 * Code highlighted on the server: a file, or one file of a diff, drawn by
 * `@pierre/diffs/ssr` with the browser's own options (`pierre.ts`) into
 * the HTML of the drawing's shadow root, which the page sends as a
 * declarative shadow root. The browser's drawing later takes its place
 * with the same highlighting, so the reader sees the code once.
 *
 * Shiki runs on its JavaScript engine (a Worker compiles no WebAssembly),
 * and only with the grammars named here: the Worker's build resolves
 * `shiki` to core alone (`vite.config.ts`), so no other grammar is
 * bundled. Pierre will not resolve a grammar or a theme by name in a
 * Worker's global scope, so each is loaded here and attached to its
 * highlighter directly, once per isolate.
 *
 * Loaded on the server only, by `prerender.ts`, on a page's first
 * highlighted code: the Worker's entry carries none of it.
 */
import {
  attachResolvedLanguages,
  attachResolvedThemes,
  getSharedHighlighter,
} from "@pierre/diffs";
import type {
  FileContents,
  FileDiffMetadata,
  LanguageRegistration,
} from "@pierre/diffs";
import { preloadDiffHTML, preloadFile } from "@pierre/diffs/ssr";
import { Effect, Option } from "effect";
import { normalizeTheme } from "shiki/core";

import type { DrawnFile } from "./diff-model.ts";
import {
  codeTheme,
  diffOptionsFor,
  diffsOptions,
  fileOptions,
} from "./pierre.ts";
import { serverLanguageOf } from "./prerender.ts";
import type { ServerLanguage } from "./prerender.ts";

type Grammar = () => Promise<{ readonly default: LanguageRegistration[] }>;

/** Each server language's grammar, loaded on first use; `yml` and `zsh` are aliases Pierre names. */
const GRAMMARS: Record<ServerLanguage, Grammar> = {
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  yml: () => import("shiki/langs/yaml.mjs"),
  zsh: () => import("shiki/langs/shellscript.mjs"),
};

/** The shared highlighter, with the token theme and `language`'s grammar attached. */
const highlighterFor = (language: ServerLanguage) =>
  Effect.gen(function* () {
    const highlighter = yield* Effect.tryPromise(() =>
      getSharedHighlighter({
        langs: [],
        preferredHighlighter: "shiki-js",
        themes: [],
      })
    );

    const grammar = yield* Effect.tryPromise(GRAMMARS[language]);

    // Each is attached once; Pierre skips one already attached. The theme
    // is normalized as Pierre normalizes a registered one.
    yield* Effect.try(() => {
      attachResolvedThemes(normalizeTheme(codeTheme()), highlighter);
      attachResolvedLanguages(
        { data: grammar.default, name: language },
        highlighter
      );
    });
  });

/**
 * A drawing in `language`; if it fails, the same drawing as plain text, so
 * the page still sends Pierre's markup; none if that fails too.
 */
const draw = <E1, E2>(
  language: Option.Option<ServerLanguage>,
  highlighted: Effect.Effect<string, E1>,
  plain: Effect.Effect<string, E2>
): Effect.Effect<string | undefined> =>
  Option.match(language, {
    onNone: () => plain,
    onSome: (name) =>
      highlighterFor(name).pipe(
        Effect.andThen(highlighted),
        Effect.catchCause(() => plain)
      ),
  }).pipe(Effect.orElseSucceed((): string | undefined => undefined));

/** A file drawn as `FileCode` draws it. */
const fileHtml = (file: FileContents) =>
  Effect.tryPromise(() => preloadFile({ file, options: fileOptions })).pipe(
    Effect.map(({ prerenderedHTML }) => prerenderedHTML)
  );

/** One file, as `FileCode` draws it. */
export const prerenderFile = (file: {
  readonly path: string;
  readonly sha: string;
  readonly text: string;
}) => {
  const contents = { cacheKey: file.sha, contents: file.text, name: file.path };

  return draw(
    serverLanguageOf(file.path),
    fileHtml(contents),
    fileHtml({ ...contents, lang: "text" })
  );
};

/**
 * A diff's body drawn without Pierre's header (the page's own sits above
 * it) sits as it does in the browser's drawing: Pierre drops the code's
 * top gap only after a header, so the lines would otherwise start 8 px
 * lower, and it takes a scrollbar's width from the bottom gap only once
 * its script has measured one, so the next file would start 6 px higher.
 */
const UNDER_HEADER_CSS =
  "[data-code] { padding-top: 0; padding-bottom: var(--diffs-gap-block, var(--diffs-gap-fallback)); }";

/** A diff's body drawn unified, as `DiffCode` draws it, without a header. */
const diffHtml = (fileDiff: FileDiffMetadata) =>
  Effect.tryPromise(() =>
    preloadDiffHTML({
      fileDiff,
      options: {
        ...diffOptionsFor(false),
        disableFileHeader: true,
        unsafeCSS: `${diffsOptions.unsafeCSS}\n${UNDER_HEADER_CSS}`,
      },
    })
  );

/**
 * One file of a diff's body, unified, as `DiffCode` draws it, under the
 * page's own header: none for a file with no lines.
 */
export const prerenderDiff = (file: DrawnFile) =>
  Option.match(file.diff, {
    onNone: () => Effect.sync((): string | undefined => undefined),
    onSome: (diff) =>
      draw(
        serverLanguageOf(file.file.path),
        diffHtml(diff),
        diffHtml({ ...diff, lang: "text" })
      ),
  });
