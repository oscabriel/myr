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
 * the browser only through the views that draw. A drawing hands its code
 * boxes over once drawn, so code too wide for its pane is a stop for Tab.
 */
import {
  DEFAULT_TOKENIZE_MAX_LENGTH,
  registerCustomCSSVariableTheme,
} from "@pierre/diffs";

/** The token theme's registered name. */
export const CODE_THEME = "repo-tokens";

/** A drawn file's code box: whether it scrolls, and whether Tab reaches it. */
interface CodeBox {
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  tabIndex: number;
}

/** A drawing as Pierre hands it over once drawn: its code boxes, in its shadow root. */
interface Drawn {
  readonly shadowRoot: {
    readonly querySelectorAll: (selectors: "code") => Iterable<CodeBox>;
  } | null;
}

/**
 * Code that scrolls (a long line, a phone's width) is a stop for Tab, so a
 * keyboard can scroll it; code that fits is not, so a page of short files
 * adds no stops.
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

/**
 * The focus ring inside a drawing's shadow root, which the page's own
 * stylesheet does not reach: the page's ink, as everywhere else.
 */
export const FOCUS_CSS =
  "code:focus-visible { outline: 2px solid var(--foreground); outline-offset: -2px; }";

/** Spread first into a drawing's own options. */
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
