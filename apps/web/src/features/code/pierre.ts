/**
 * The theme reads CSS variables `styles.css` sets from the web's tokens. It is
 * named for both schemes, so Pierre leaves the scheme to the page (a single
 * name would fix it; Shiki calls a variable theme dark). It carries colour
 * only: Pierre resolves a token's weight and slant through `light-dark()`,
 * which takes colours only. The server draws with these same options, so the
 * browser's drawing replaces it with nothing changing.
 */
import {
  createCSSVariablesTheme,
  DEFAULT_TOKENIZE_MAX_LENGTH,
  formatCSSVariablePrefix,
  registerCustomTheme,
} from "@pierre/diffs";

export const CODE_THEME = "repo-tokens";

interface CodeBox {
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  tabIndex: number;
}

interface Drawn {
  readonly shadowRoot: {
    readonly querySelectorAll: (selectors: "code") => Iterable<CodeBox>;
  } | null;
}

/**
 * Code that scrolls is a stop for Tab, so a keyboard can scroll it; code that
 * fits is not.
 */
const reachScrolledCode = (node: Drawn) => {
  for (const code of node.shadowRoot?.querySelectorAll("code") ?? []) {
    code.tabIndex =
      code.scrollWidth > code.clientWidth ||
      code.scrollHeight > code.clientHeight
        ? 0
        : -1;
  }
};

/** The page's own stylesheet does not reach a drawing's shadow root. */
export const FOCUS_CSS =
  "code:focus-visible { outline: 2px solid var(--foreground); outline-offset: -2px; }";

export const diffsOptions = {
  maxLineDiffLength: 1000,
  onPostRender: reachScrolledCode,
  preferredHighlighter: "shiki-js",
  theme: { dark: CODE_THEME, light: CODE_THEME },
  themeType: "system",
  tokenizeMaxLength: DEFAULT_TOKENIZE_MAX_LENGTH,
  tokenizeMaxLineLength: 1000,
  unsafeCSS: FOCUS_CSS,
} as const;

export const fileOptions = {
  ...diffsOptions,
  disableFileHeader: true,
  enableLineSelection: true,
  lineHoverHighlight: "number",
  overflow: "scroll",
} as const;

export const diffOptionsFor = (split: boolean) =>
  ({
    ...diffsOptions,
    diffIndicators: split ? "bars" : "classic",
    diffStyle: split ? "split" : "unified",
    enableLineSelection: true,
    hunkSeparators: "line-info",
    lineDiffType: "word-line",
    lineHoverHighlight: "both",
    overflow: "scroll",
  }) as const;

export const treesOptions = { density: "compact", icons: "minimal" } as const;

const variableDefaults = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  "token-comment": "var(--muted)",
  "token-constant": "var(--foreground)",
  "token-function": "var(--foreground)",
  "token-keyword": "var(--foreground)",
  "token-link": "var(--foreground)",
  "token-parameter": "var(--foreground)",
  "token-punctuation": "var(--muted)",
  "token-string": "var(--foreground)",
  "token-string-expression": "var(--foreground)",
};

/**
 * The server attaches it to its highlighter directly: Pierre refuses to resolve
 * a theme by name in a Worker's global scope.
 */
export const codeTheme = () =>
  createCSSVariablesTheme({
    fontStyle: false,
    name: CODE_THEME,
    variableDefaults,
    variablePrefix: formatCSSVariablePrefix("global"),
  });

/** Pierre refuses a name registered twice. */
const registered = { done: false };

export const registerCodeTheme = () => {
  if (!registered.done) {
    registered.done = true;
    registerCustomTheme(CODE_THEME, () => Promise.resolve(codeTheme()));
  }
};
