/**
 * `shiki` as the web Worker bundles it (`vite.config.ts` resolves the
 * Worker's `shiki` here): Shiki's core and its JavaScript regex engine,
 * with no bundled grammar or theme and no WebAssembly.
 *
 * The package's own entry maps every grammar and theme to a dynamic
 * import, about 10 MB the Worker's build would carry, and its Oniguruma
 * engine compiles WebAssembly, which a Worker may not. `@pierre/diffs`
 * imports both from `shiki`; it reaches neither on the server, where the
 * few grammars the server highlights in are loaded and attached by
 * `features/code/prerender-server.ts`. So here the bundled maps are empty,
 * and asking for Oniguruma fails.
 */
import {
  createBundledHighlighter,
  createSingletonShorthands,
  guessEmbeddedLanguages,
} from "shiki/core";
import type {
  DynamicImportLanguageRegistration,
  DynamicImportThemeRegistration,
  RegexEngine,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export * from "shiki/core";

export { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/** No grammar is bundled by name; each is attached where it is used. */
export const bundledLanguages: Record<
  string,
  DynamicImportLanguageRegistration
> = {};

/** No theme is bundled by name; the token theme is attached where it is used. */
export const bundledThemes: Record<string, DynamicImportThemeRegistration> = {};

/** Oniguruma compiles WebAssembly, which a Worker may not: never on the server. */
export const createOnigurumaEngine = (): Promise<RegexEngine> =>
  Promise.reject(
    new Error("The Worker highlights with the JavaScript engine only")
  );

export const createHighlighter = createBundledHighlighter<string, string>({
  engine: () => createJavaScriptRegexEngine(),
  langs: bundledLanguages,
  themes: bundledThemes,
});

export const {
  codeToHast,
  codeToHtml,
  codeToTokens,
  codeToTokensBase,
  codeToTokensWithThemes,
  getLastGrammarState,
  getSingletonHighlighter,
} = createSingletonShorthands(createHighlighter, { guessEmbeddedLanguages });
