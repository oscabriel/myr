// `shiki` for the Worker: the package's entry maps every grammar and theme to a dynamic import (about 10 MB),
// and its Oniguruma engine compiles WebAssembly, which a Worker may not. The server attaches its few grammars itself.
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

export const bundledLanguages: Record<
  string,
  DynamicImportLanguageRegistration
> = {};

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
