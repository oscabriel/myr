// Measured as WCAG 2.2 does: oklch to sRGB through oklab by Björn Ottosson's published matrices, then relative luminance.
import { describe, expect, it } from "@effect/vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Input } from "../src/components/ui/input.tsx";
import { Textarea } from "../src/components/ui/textarea.tsx";

import styles from "../src/styles.css?raw";

/** The stylesheet with its comments gone, so a comment never reads as a rule. */
const css = styles.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

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

const blockOf = (selector: string, from = 0): string => {
  const at = css.indexOf(`${selector} {`, from);

  return at === -1 ? "" : blockFrom(css.indexOf("{", at));
};

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
    blockOf(
      ":root",
      // The block, not the `dark` variant's own mention of the query.
      css.indexOf("@media (prefers-color-scheme: dark) {")
    )
  ),
]);

type Scheme = "dark" | "light";

const tokensOf = (scheme: Scheme) =>
  scheme === "light" ? lightTokens : darkTokens;

interface Oklch {
  readonly chroma: number;
  readonly hue: number;
  readonly lightness: number;
}

const valueOf = (scheme: Scheme, name: string): string => {
  const value = tokensOf(scheme).get(name);

  if (value === undefined) {
    throw new Error(`--${name} is not declared for ${scheme}`);
  }

  const alias = /^var\(--(?<name>[\w-]+)\)$/u.exec(value)?.groups?.name;

  return alias === undefined ? value : valueOf(scheme, alias);
};

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

const linear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const clamp = (channel: number) => Math.min(1, Math.max(0, channel));

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

const luminanceOf = (scheme: Scheme, name: string) => {
  const value = valueOf(scheme, name);

  const [red, green, blue] = /^#[\da-f]{6}$/iu.test(value)
    ? ([1, 3, 5] as const).map((at) =>
        linear(Number.parseInt(value.slice(at, at + 2), 16) / 255)
      )
    : linearOfOklch(oklchOf(scheme, name));

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};

const contrast = (scheme: Scheme, one: string, other: string) => {
  const [lighter, darker] = [
    luminanceOf(scheme, one),
    luminanceOf(scheme, other),
  ].toSorted((a, b) => b - a);

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

const STATES = ["landed", "checking", "waiting", "refused", "sealed"] as const;

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

const hueDistance = (one: number, other: number) => {
  const apart = Math.abs(one - other) % 360;

  return Math.min(apart, 360 - apart);
};

/**
 * Under this chroma a colour reads as grey, and its hue as nothing: ink and
 * muted carry a trace of blue that no one sees as checking's.
 */
const NEUTRAL_CHROMA = 0.02;

const statesNear = (scheme: Scheme, hue: number) =>
  STATES.filter((state) => hueDistance(hue, oklchOf(scheme, state).hue) < 30);

describe.each(["light", "dark"] as const)("the %s scheme", (scheme) => {
  it.each(["foreground", "muted"])(
    "keeps --%s at 4.5:1 on paper, on the surface and on the pressed surface",
    (text) => {
      expect(contrast(scheme, text, "background")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(scheme, text, "surface")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(scheme, text, "surface-2")).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(STATES)(
    "keeps --%s at 5:1 on paper, on the surface and on the pressed surface",
    (state) => {
      expect(contrast(scheme, state, "background")).toBeGreaterThanOrEqual(5);
      expect(contrast(scheme, state, "surface")).toBeGreaterThanOrEqual(5);
      expect(contrast(scheme, state, "surface-2")).toBeGreaterThanOrEqual(5);
    }
  );

  // A selected row under the pointer is one step past the surface: a step
  // that can be seen, and never a zone of its own.
  it("steps the pressed surface just past the surface", () => {
    expect(contrast(scheme, "surface-2", "surface")).toBeGreaterThan(1);
    expect(contrast(scheme, "surface-2", "background")).toBeLessThan(1.25);
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

/** sRGB's transfer curve, for writing a colour out as the hex a meta repeats. */
const encoded = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

const hexOfOklch = (colour: Oklch) =>
  `#${linearOfOklch(colour)
    .map((channel) =>
      Math.round(encoded(channel) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;

const oklchOfText = (value: string): Oklch => {
  const [lightness, chroma, hue] = value.split(" ").map(Number);

  return { chroma: chroma ?? 0, hue: hue ?? 0, lightness: lightness ?? 0 };
};

/**
 * The maintainer's "sage garden" palette as pasted (2026-10-12), by the web's
 * token each value fills: shadcn's `muted` is the web's field surface and its
 * `border` the hairline. Copied here as the test's own source of truth.
 */
const SAGE_GARDEN = {
  dark: {
    accent: "0.3709 0.0248 153.9823",
    card: "0.1822 0 0",
    foreground: "0.9702 0 0",
    popover: "0.1822 0 0",
    primary: "0.6333 0.0309 154.9039",
    rule: "0.2850 0 0",
    secondary: "0.2178 0 0",
    surface: "0.2178 0 0",
  },
  light: {
    accent: "0.8242 0.0221 136.6092",
    card: "1.0000 0 0",
    foreground: "0.2417 0.0298 269.8827",
    popover: "1.0000 0 0",
    rule: "0.9251 0.0071 88.6450",
    secondary: "0.8596 0.0291 119.9919",
    surface: "0.9251 0.0071 88.6450",
  },
} as const;

const SAGE_PAPER = {
  dark: "0.1448 0 0",
  light: "0.9761 0.0041 91.4461",
} as const;

/** Values the palette gave that failed a pair below, nudged in lightness alone. */
const SAGE_NUDGED = {
  dark: { refused: "0.6368 0.2078 25.3313" },
  light: {
    muted: "0.5510 0.0234 264.3637",
    primary: "0.6333 0.0309 154.9039",
    refused: "0.5624 0.1743 26.1433",
  },
} as const;

const sameColour = (one: Oklch, other: Oklch) =>
  [
    one.lightness - other.lightness,
    one.chroma - other.chroma,
    hueDistance(one.hue, other.hue),
  ].every((apart) => Math.abs(apart) < 0.0001);

/** Every token in a scheme declared as an oklch(), by name. */
const oklchTokens = (scheme: Scheme) =>
  [...tokensOf(scheme).keys()].flatMap((name) =>
    valueOf(scheme, name).startsWith("oklch(")
      ? [[name, oklchOf(scheme, name)] as const]
      : []
  );

/** Orange, amber and brown, which no colour on the web may be. */
const ORANGE_HUES = { from: 40, to: 100 } as const;

describe.each(["light", "dark"] as const)("the %s sage garden", (scheme) => {
  it("lays the paper in the palette's background, as hex", () => {
    expect(valueOf(scheme, "background")).toBe(
      hexOfOklch(oklchOfText(SAGE_PAPER[scheme]))
    );
  });

  it.each(Object.entries(SAGE_GARDEN[scheme]))(
    "takes --%s from the palette unchanged",
    (token, value) => {
      expect(
        sameColour(oklchOf(scheme, token), oklchOfText(value))
      ).toBeTruthy();
    }
  );

  it.each(Object.entries(SAGE_NUDGED[scheme]))(
    "moves --%s from the palette in lightness alone",
    (token, value) => {
      const { lightness, ...colour } = oklchOf(scheme, token);
      const pasted = oklchOfText(value);

      expect(lightness).not.toBe(pasted.lightness);
      expect(
        sameColour({ ...colour, lightness }, { ...pasted, lightness })
      ).toBeTruthy();
    }
  );

  it("spends no orange, amber or brown, state roles included", () => {
    const orange = oklchTokens(scheme).flatMap(([name, { chroma, hue }]) =>
      chroma >= NEUTRAL_CHROMA &&
      hue >= ORANGE_HUES.from &&
      hue <= ORANGE_HUES.to
        ? [name]
        : []
    );

    expect(orange).toStrictEqual([]);
  });

  it("keeps --waiting's hue 30° from every other state's", () => {
    const { hue } = oklchOf(scheme, "waiting");

    expect(
      STATES.filter(
        (state) =>
          state !== "waiting" &&
          hueDistance(hue, oklchOf(scheme, state).hue) < 30
      )
    ).toStrictEqual([]);
  });

  it.each(["primary", "secondary", "accent"])(
    "sets the word on --%s at 4.5:1",
    (fill) => {
      expect(
        contrast(scheme, `${fill}-foreground`, fill)
      ).toBeGreaterThanOrEqual(4.5);
    }
  );

  it("draws the focus ring at 3:1 on paper and on the surface", () => {
    expect(contrast(scheme, "ring", "background")).toBeGreaterThanOrEqual(3);
    expect(contrast(scheme, "ring", "surface")).toBeGreaterThanOrEqual(3);
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
      "diffs-bg-addition-emphasis-override",
      "diffs-bg-deletion-emphasis-override",
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

  // Pierre reads --diffs-bg-deletion-override both as the colour it mixes a
  // line from and, unmixed, as the light half of a deletion bar's dashes:
  // set it, and the bar turns solid, telling a deletion from an addition by
  // colour alone. Left unset, the line is mixed from the sign colour.
  it("leave a changed line's background to Pierre's mix, so a deletion's bar keeps its dashes", () => {
    const mapped = declarations(diffs);

    expect(
      [
        "diffs-bg-addition-override",
        "diffs-bg-addition-number-override",
        "diffs-bg-deletion-override",
        "diffs-bg-deletion-number-override",
      ].filter((name) => mapped.has(name))
    ).toStrictEqual([]);
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

/** Each `@font-face` rule in the stylesheet, as its family and its sources. */
const faces = [...css.matchAll(/@font-face\s*\{(?<body>[^}]*)\}/gu)].map(
  ({ groups }) => {
    const body = groups?.body ?? "";

    return {
      family: /font-family:\s*"(?<family>[^"]+)"/u.exec(body)?.groups?.family,
      sources: [...body.matchAll(/url\("(?<url>[^"]+)"\)/gu)].map(
        (match) => match.groups?.url ?? ""
      ),
      weight: /font-weight:\s*(?<weight>[^;]+);/u.exec(body)?.groups?.weight,
    };
  }
);

const weightsOf = (family: string) =>
  faces.flatMap((face) => (face.family === family ? [face.weight ?? ""] : []));

const SANS_FILES = "@fontsource-variable/ibm-plex-sans/files/";

const MONO_FILES = "@fontsource/ibm-plex-mono/files/";

describe("the faces", () => {
  const theme = declarations(blockOf("@theme inline"));

  it("set the UI in IBM Plex Sans and code in IBM Plex Mono, each over its metric fallback", () => {
    expect(theme.get("font-sans")?.split(", ").slice(0, 2)).toStrictEqual([
      '"IBM Plex Sans Variable"',
      '"IBM Plex Sans Fallback"',
    ]);
    expect(theme.get("font-mono")?.split(", ").slice(0, 2)).toStrictEqual([
      '"IBM Plex Mono"',
      '"IBM Plex Mono Fallback"',
    ]);
    expect(theme.has("font-serif")).toBeFalsy();
  });

  it("load each face from fontsource, latin and latin-ext only", () => {
    const files = faces.flatMap(({ sources }) => sources);

    expect(files.length).toBeGreaterThan(0);
    expect(
      files.filter(
        (file) =>
          !(file.startsWith(SANS_FILES) || file.startsWith(MONO_FILES)) ||
          !/-latin-(?:ext-)?(?:wght|\d00)-normal\.woff2$/u.test(file)
      )
    ).toStrictEqual([]);
  });

  it("load the variable sans once per subset, and mono at the three weights the UI sets", () => {
    expect(weightsOf("IBM Plex Sans Variable")).toStrictEqual([
      "100 700",
      "100 700",
    ]);
    expect(weightsOf("IBM Plex Mono").toSorted()).toStrictEqual([
      "400",
      "400",
      "500",
      "500",
      "600",
      "600",
    ]);
  });

  it("keep no vendored font file in the web's sources", () => {
    const vendored = import.meta.glob("../src/assets/fonts/*", {
      query: "?url",
    });

    expect(Object.keys(vendored)).toStrictEqual([]);
  });
});

describe("the shells' widths", () => {
  const layout = declarations(blockOf("@theme static"));
  const breakpoints = declarations(blockOf("@theme"));

  // Spec 3.1: each shell's container, its side columns, and prose's measure.
  it.each([
    ["container-site", "85rem"],
    ["container-project", "100rem"],
    ["container-focus", "25rem"],
    ["column-about", "21.25rem"],
    ["column-tree", "17.5rem"],
    ["column-docs-nav", "15rem"],
    ["column-docs-toc", "13.75rem"],
    ["gutter-site", "2rem"],
    ["gutter-project", "1.75rem"],
    ["measure", "72ch"],
  ])("names --%s as %s", (token, width) => {
    expect(layout.get(token)).toBe(width);
  });

  it("stacks side columns below 1100 px and folds the top bar's links below 900 px", () => {
    expect(breakpoints.get("breakpoint-columns")).toBe("68.75rem");
    expect(breakpoints.get("breakpoint-nav")).toBe("56.25rem");
  });
});
