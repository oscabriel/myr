/**
 * Shiki runs on its JavaScript engine (a Worker compiles no WebAssembly), and
 * the Worker's build resolves `shiki` to core alone (`vite.config.ts`), so only
 * the grammars named here are bundled. Pierre will not resolve a grammar or a
 * theme by name in a Worker's global scope, so each is attached to its
 * highlighter directly, once per isolate.
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

    yield* Effect.try(() => {
      attachResolvedThemes(normalizeTheme(codeTheme()), highlighter);
      attachResolvedLanguages(
        { data: grammar.default, name: language },
        highlighter
      );
    });
  });

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

const fileHtml = (file: FileContents) =>
  Effect.tryPromise(() => preloadFile({ file, options: fileOptions })).pipe(
    Effect.map(({ prerenderedHTML }) => prerenderedHTML)
  );

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
 * Pierre drops the code's top gap only after a header, and takes a scrollbar's
 * width from the bottom gap only once its script has measured one; this keeps a
 * headerless body where the browser's drawing puts it.
 */
const UNDER_HEADER_CSS =
  "[data-code] { padding-top: 0; padding-bottom: var(--diffs-gap-block, var(--diffs-gap-fallback)); }";

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
