/**
 * What every drawing of code shares: the options each `@pierre/diffs` view
 * spreads into its own (`File`, `MultiFileDiff`, `FileDiff`), the options
 * of the `@pierre/trees` file tree, and the colour theme they draw in.
 *
 * The theme reads CSS variables (`--diffs-token-*`, `--diffs-foreground`,
 * `--diffs-background`), which `styles.css` sets on every
 * `diffs-container` from the web's own tokens: code sits on the paper and
 * follows the system's light or dark setting with the page, in low-chroma
 * colours that never borrow a state's. It is named for both schemes, so
 * Pierre leaves the scheme to the page: a single theme name would fix it
 * to the theme's own type (Shiki calls a variable theme dark). Colour is
 * all it carries: Pierre resolves a token's weight and slant through
 * `light-dark()`, which takes colours only, so a two-scheme drawing drops
 * them.
 *
 * The limits are Pierre's own defaults, written out so a reader sees them:
 * past them a file (or a line, or a changed line's pair) is drawn as plain
 * text, so a minified bundle or a lockfile cannot stall the page.
 *
 * No React and no DOM here: the module loads in Node for its test, and in
 * the browser only through the views that draw.
 */
import {
  DEFAULT_TOKENIZE_MAX_LENGTH,
  registerCustomCSSVariableTheme,
} from "@pierre/diffs";

/** The token theme's registered name. */
export const CODE_THEME = "repo-tokens";

/** Spread first into a drawing's own options. */
export const diffsOptions = {
  maxLineDiffLength: 1000,
  preferredHighlighter: "shiki-js",
  theme: { dark: CODE_THEME, light: CODE_THEME },
  themeType: "system",
  tokenizeMaxLength: DEFAULT_TOKENIZE_MAX_LENGTH,
  tokenizeMaxLineLength: 1000,
} as const;

/** The file tree's look: compact rows, plain icons (`styles.css` greys them). */
export const treesOptions = { density: "compact", icons: "minimal" } as const;

/**
 * Where a variable is not set (a drawing outside `diffs-container`'s
 * mapping), the page's own tokens stand in.
 */
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

/** Whether this page has registered the theme yet; Pierre refuses a name twice. */
const registered = { done: false };

/** Registers the token theme, once; each drawing calls it before it draws. */
export const registerCodeTheme = () => {
  if (!registered.done) {
    registered.done = true;
    registerCustomCSSVariableTheme(CODE_THEME, variableDefaults);
  }
};
