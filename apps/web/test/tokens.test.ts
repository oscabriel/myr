/**
 * The web's tokens, read from `styles.css` as text and measured the way
 * WCAG 2.2 measures them: each colour converted to sRGB (oklch through
 * oklab, by Björn Ottosson's published matrices; hex directly), then
 * compared by relative luminance. Light is `:root`; dark is `:root` with
 * the `prefers-color-scheme: dark` block laid over it, as a browser
 * resolves it.
 *
 * What holds: text at 4.5:1 and state colours at 5:1 on paper and on the
 * surface; control borders at 3:1 (SC 1.4.11); a skeleton's stroke that can
 * be seen; diff signs readable apart from the state colours; code coloured
 * with low chroma, far from every state hue; the kit's controls never under
 * 13 px; and Pierre's shadow roots fed from the tokens, never from the
 * state colours (bar the viewer's own selection).
 */
import { describe, expect, it } from "@effect/vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Input } from "../src/components/ui/input.tsx";
import { Textarea } from "../src/components/ui/textarea.tsx";

import styles from "../src/styles.css?raw";

/** The stylesheet with its comments gone, so a comment never reads as a rule. */
const css = styles.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

/** The text between the brace at `open` and the one that closes it. */
const blockFrom = (open: number): string => {
  let depth = 0;

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return css.slice(open + 1, index);
      }
    }
  }

  return "";
};

/** The block a selector opens, searched from `from`; empty when there is none. */
const blockOf = (selector: string, from = 0): string => {
  const at = css.indexOf(`${selector} {`, from);

  return at === -1 ? "" : blockFrom(css.indexOf("{", at));
};

/** Each `--name: value;` a block declares. */
const declarations = (block: string): ReadonlyMap<string, string> =>
  new Map(
    [...block.matchAll(/--(?<name>[\w-]+):\s*(?<value>[^;]+);/gu)].map(
      ({ groups }) => [
        groups?.name ?? "",
        (groups?.value ?? "").replaceAll(/\s+/gu, " ").trim(),
      ]
    )
  );

const lightTokens = declarations(blockOf(":root"));

const darkTokens = new Map([
  ...lightTokens,
  ...declarations(
    blockOf(":root", css.indexOf("@media (prefers-color-scheme: dark)"))
  ),
]);

type Scheme = "dark" | "light";

const tokensOf = (scheme: Scheme) =>
  scheme === "light" ? lightTokens : darkTokens;

/** A colour as oklch, the form the tokens are written in. */
interface Oklch {
  readonly chroma: number;
  readonly hue: number;
  readonly lightness: number;
}

/** A token's value with every `var(--x)` alias followed. */
const valueOf = (scheme: Scheme, name: string): string => {
  const value = tokensOf(scheme).get(name);

  if (value === undefined) {
    throw new Error(`--${name} is not declared for ${scheme}`);
  }

  const alias = /^var\(--(?<name>[\w-]+)\)$/u.exec(value)?.groups?.name;

  return alias === undefined ? value : valueOf(scheme, alias);
};

/** A token as oklch; fails when it is written in any other form. */
const oklchOf = (scheme: Scheme, name: string): Oklch => {
  const value = valueOf(scheme, name);

  const parts =
    /^oklch\((?<lightness>[\d.]+) (?<chroma>[\d.]+) (?<hue>[\d.]+)\)$/u.exec(
      value
    )?.groups;

  if (parts === undefined) {
    throw new Error(`--${name} is ${value} for ${scheme}, not an oklch()`);
  }

  return {
    chroma: Number(parts.chroma),
    hue: Number(parts.hue),
    lightness: Number(parts.lightness),
  };
};

/** One sRGB channel, 0–1, made linear. */
const linear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const clamp = (channel: number) => Math.min(1, Math.max(0, channel));

/** Linear sRGB of an oklch colour, clipped into the gamut. */
const linearOfOklch = ({ chroma, hue, lightness }: Oklch) => {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ] as const;
};

/** Relative luminance of a token, written as oklch or as `#rrggbb`. */
const luminanceOf = (scheme: Scheme, name: string) => {
  const value = valueOf(scheme, name);

  const [red, green, blue] = /^#[\da-f]{6}$/iu.test(value)
    ? ([1, 3, 5] as const).map((at) =>
        linear(Number.parseInt(value.slice(at, at + 2), 16) / 255)
      )
    : linearOfOklch(oklchOf(scheme, name));

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};

/** WCAG's contrast ratio between two tokens. */
const contrast = (scheme: Scheme, one: string, other: string) => {
  const [lighter, darker] = [
    luminanceOf(scheme, one),
    luminanceOf(scheme, other),
  ].toSorted((a, b) => b - a);

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

/** The colours that mean a state, and nothing else may borrow. */
const STATES = ["landed", "checking", "waiting", "refused", "sealed"] as const;

/** The syntax colours code is drawn in. */
const SYNTAX = [
  "syntax-keyword",
  "syntax-function",
  "syntax-parameter",
  "syntax-string",
  "syntax-constant",
  "syntax-comment",
  "syntax-punctuation",
  "syntax-link",
] as const;

/** The degrees between two hues, the short way round. */
const hueDistance = (one: number, other: number) => {
  const apart = Math.abs(one - other) % 360;

  return Math.min(apart, 360 - apart);
};

/**
 * Under this chroma a colour reads as grey, and its hue as nothing: ink and
 * muted carry a trace of blue that no one sees as checking's.
 */
const NEUTRAL_CHROMA = 0.02;

/** The states whose hue sits within 30° of `hue`. */
const statesNear = (scheme: Scheme, hue: number) =>
  STATES.filter((state) => hueDistance(hue, oklchOf(scheme, state).hue) < 30);

describe.each(["light", "dark"] as const)("the %s scheme", (scheme) => {
  it.each(["foreground", "muted"])(
    "keeps --%s at 4.5:1 on paper and on the surface",
    (text) => {
      expect(contrast(scheme, text, "background")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(scheme, text, "surface")).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(STATES)("keeps --%s at 5:1 on paper and on the surface", (state) => {
    expect(contrast(scheme, state, "background")).toBeGreaterThanOrEqual(5);
    expect(contrast(scheme, state, "surface")).toBeGreaterThanOrEqual(5);
  });

  it("draws a control's border at 3:1 on paper and on the surface", () => {
    expect(contrast(scheme, "input", "background")).toBeGreaterThanOrEqual(3);
    expect(contrast(scheme, "input", "surface")).toBeGreaterThanOrEqual(3);
  });

  it("strokes a skeleton at 1.5:1 on paper, so a placeholder can be seen", () => {
    expect(contrast(scheme, "skeleton", "background")).toBeGreaterThanOrEqual(
      1.5
    );
  });

  // A changed line's number takes the sign's colour, so it is held as text.
  it.each(["diff-add-sign", "diff-del-sign"])(
    "draws --%s at 4.5:1 on paper",
    (sign) => {
      expect(contrast(scheme, sign, "background")).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(["diff-add-sign", "diff-del-sign"])(
    "keeps --%s's hue 30° from every state colour's",
    (sign) => {
      expect(statesNear(scheme, oklchOf(scheme, sign).hue)).toStrictEqual([]);
    }
  );

  it.each(SYNTAX)("keeps --%s low in chroma, away from the states", (token) => {
    const { chroma, hue } = oklchOf(scheme, token);

    expect(chroma).toBeLessThanOrEqual(0.035);
    expect(
      chroma < NEUTRAL_CHROMA ? [] : statesNear(scheme, hue)
    ).toStrictEqual([]);
  });

  it.each(SYNTAX)("keeps --%s at 4.5:1 on paper", (token) => {
    expect(contrast(scheme, token, "background")).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    "diff-add-bg",
    "diff-add-emphasis",
    "diff-del-bg",
    "diff-del-emphasis",
  ])("declares --%s", (tint) => {
    expect(valueOf(scheme, tint)).not.toBe("");
  });
});

describe("Pierre's shadow roots", () => {
  const diffs = blockOf("diffs-container");
  const trees = blockOf("file-tree-container");

  const roles = new RegExp(`var\\(--(?:${STATES.join("|")})\\)`, "u");

  it("draw code without ligatures, so `=>` stays two characters", () => {
    expect(declarations(diffs).get("diffs-font-features")).toBe(
      '"calt" 0, "liga" 0'
    );
  });

  it("set no variable the installed diffs never reads", () => {
    expect(
      declarations(diffs).has("diffs-selection-color-override")
    ).toBeFalsy();
  });

  it("take a diff's colours from its own tints, never from landed or refused", () => {
    const mapped = declarations(diffs);

    const elsewhere = [
      "diffs-addition-color-override",
      "diffs-deletion-color-override",
      "diffs-bg-addition-override",
      "diffs-bg-deletion-override",
    ].filter(
      (name) => !/^var\(--diff-(?:add|del)-/u.test(mapped.get(name) ?? "")
    );

    expect(elsewhere).toStrictEqual([]);

    // Only the viewer's own selection borrows a state's hue: checking's.
    const borrowing = [...mapped].flatMap(([name, value]) =>
      roles.test(value) ? [name] : []
    );

    expect(borrowing.toSorted()).toStrictEqual([
      "diffs-bg-selection-number-override",
      "diffs-bg-selection-override",
    ]);
  });

  it("mark a file tree's changes in the diff tints, and spend no state colour", () => {
    const mapped = declarations(trees);

    expect(mapped.get("trees-git-added-color-override")).toBe(
      "var(--diff-add-sign)"
    );
    expect(mapped.get("trees-git-deleted-color-override")).toBe(
      "var(--diff-del-sign)"
    );
    expect([...mapped].filter(([, value]) => roles.test(value))).toStrictEqual(
      []
    );
  });
});

describe("the kit's controls", () => {
  const kit: Readonly<Record<string, string>> = import.meta.glob(
    "../src/components/ui/*.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  it("set nothing under 13 px", () => {
    expect(Object.keys(kit).length).toBeGreaterThan(20);

    const small =
      /(?<![\w-])text-(?:xs|\[(?:0\.6875|0\.75)rem\]|\[1[0-2]px\])(?![\w-])/u;

    const under = Object.entries(kit).flatMap(([path, source]) =>
      small.test(source) ? [path] : []
    );

    expect(under).toStrictEqual([]);
  });

  // iOS zooms the page when a field under 16 px takes focus.
  it.each([
    ["an input", createElement(Input)],
    ["a textarea", createElement(Textarea)],
  ])("type %s at 16 px on a phone and 14 px from 640 px", (_, element) => {
    const classes = new Set(
      /class="(?<classes>[^"]*)"/u
        .exec(renderToStaticMarkup(element))
        ?.groups?.classes?.split(" ")
    );

    expect(classes.has("text-base")).toBeTruthy();
    expect(classes.has("sm:text-ui")).toBeTruthy();
    expect(classes.has("border-input")).toBeTruthy();
  });
});

describe("the type scale", () => {
  const theme = declarations(blockOf("@theme inline"));

  // Each role's size and line, as the design names them.
  it.each([
    ["headline", "1.5rem", "2rem"],
    ["title", "1.1875rem", "1.6rem"],
    ["want", "1rem", "1.5rem"],
    ["body", "1rem", "1.55rem"],
    ["ui", "0.875rem", "1.3rem"],
    ["label", "0.8125rem", "1.15rem"],
    ["mono", "0.8125rem", "1.25rem"],
  ])("sets text-%s at %s on a %s line", (role, size, line) => {
    expect(theme.get(`text-${role}`)).toBe(size);
    expect(theme.get(`text-${role}--line-height`)).toBe(line);
  });

  it("gives mono a terminal's line and a code line", () => {
    expect(theme.get("leading-terminal")).toBe("1.5rem");
    expect(theme.get("leading-code")).toBe("20px");
  });
});
