import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";

import design from "../../../DESIGN.md?raw";
import { PathTrail } from "../src/features/code/file-header.tsx";
import { ProjectFrame } from "../src/features/project/project-frame.tsx";
import {
  STATE_MARK_NAMES,
  STATE_MARKS,
} from "../src/features/shared/marks.tsx";
import { wordTone } from "../src/features/shared/row.tsx";
import { AppShell } from "../src/features/shared/shell/app-shell.tsx";
import { MEASURE } from "../src/features/shared/shell/workspace.tsx";
import { renderAt } from "./render.tsx";

import styles from "../src/styles.css?raw";

const sources: Readonly<Record<string, string>> = import.meta.glob(
  "../src/**/*.{ts,tsx,css}",
  { eager: true, import: "default", query: "?raw" }
);

/**
 * A small, tracked line above a headline, by any of its usual names, as a
 * whole word or one part of an identifier (`SectionEyebrow`, `hero-kicker`,
 * `KICKER`), never inside a longer word such as "kickers".
 */
const EYEBROW =
  /(?<![A-Za-z])(?:eyebrow|kicker|overline|EYEBROW|KICKER|OVERLINE)(?![A-Za-z])|(?<![A-Z])(?:Eyebrow|Kicker|Overline)(?![a-z])/gu;

const eyebrowsIn = (source: string) =>
  [...source.matchAll(EYEBROW)].map(([name]) => name);

const EDGE_COLOURS =
  "landed|checking|waiting|refused|sealed|primary|destructive";

const thickEdge =
  /(?<![\w-])(?:[\w-]+:)*border-(?<edge>[lrtbse])-(?<width>\d+|\[[\d.]+(?:px|rem)\])(?![\w-])/gu;

/** A state or primary colour as a class's name or an arbitrary `var(--…)`. */
const EDGE_COLOUR = `(?:(?:${EDGE_COLOURS})(?:/\\d+)?|\\[(?:color:)?var\\(--(?:${EDGE_COLOURS})\\)\\])`;

const colouredEdge = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*border-(?<edge>[lrtbse])-${EDGE_COLOUR}(?![\\w-])`,
  "gu"
);

const colouredBorder = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*border-${EDGE_COLOUR}(?![\\w-])`,
  "u"
);

/** An inset shadow offset past a hairline on one axis, the other way to draw a strip. */
const insetStrip =
  /(?<![\w-])(?:[\w-]+:)*shadow-\[inset_(?<x>-?[\d.]+)(?:px)?_(?<y>-?[\d.]+)(?:px)?[^\]]*\]/gu;

const stateColour = new RegExp(
  `var\\(--(?:${EDGE_COLOURS})\\)|(?<![\\w-])(?:[\\w-]+:)*shadow-(?:${EDGE_COLOURS})(?![\\w-])`,
  "u"
);

const pixels = (width: string) => {
  const [, amount = "0", unit = "px"] =
    /^\[?(?<amount>[\d.]+)(?<unit>px|rem)?\]?$/u.exec(width) ?? [];

  return unit === "rem" ? Number(amount) * 16 : Number(amount);
};

/**
 * A fingernail: one edge of a card, row or panel drawn thicker than a
 * hairline in a state's colour or the primary's, in the same string of
 * classes or on the same edge anywhere in the file; or an inset shadow
 * offset past a hairline in such a colour. A `before:` pseudo-element drawn
 * as a strip is left to review.
 */
const fingernailsIn = (source: string) => {
  const literals = source.match(/"[^"]*"|'[^']*'|`[^`]*`/gu) ?? [];

  const coloured = new Set(
    [...source.matchAll(colouredEdge)].map(({ groups }) => groups?.edge)
  );

  return literals.flatMap((literal) => [
    ...[...literal.matchAll(thickEdge)].flatMap(({ 0: found, groups }) =>
      pixels(groups?.width ?? "0") > 1 &&
      (coloured.has(groups?.edge) || colouredBorder.test(literal))
        ? [found]
        : []
    ),
    ...[...literal.matchAll(insetStrip)].flatMap(({ 0: found, groups }) =>
      Math.max(
        Math.abs(Number(groups?.x ?? 0)),
        Math.abs(Number(groups?.y ?? 0))
      ) > 1 && stateColour.test(literal)
        ? [found]
        : []
    ),
  ]);
};

const spacing = (name: string) =>
  new RegExp(`^ {2}${name}: "(?<value>[^"]+)"$`, "mu").exec(design)?.groups
    ?.value;

/** A section of DESIGN.md by its heading, up to the next heading of its level or above. */
const section = (heading: string) => {
  const found = new RegExp(`^(?<level>#{2,3}) ${heading}$`, "mu").exec(design);
  const level = found?.groups?.level ?? "";

  if (found === null) {
    return "";
  }

  const rest = design.slice(found.index + found[0].length);
  const next = new RegExp(`^#{2,${level.length}} `, "mu").exec(rest);

  return rest.slice(0, next?.index);
};

/** A layout token's value in styles.css's `@theme static` block. */
const layoutToken = (name: string) =>
  new RegExp(`@theme static \\{[^}]*--${name}: (?<value>[^;]+);`, "u").exec(
    styles
  )?.groups?.value;

const LAYOUT = [
  "container-site",
  "container-project",
  "container-focus",
  "container-figure",
  "frame-inset",
  "frame-gap",
  "column-about",
  "column-tree",
  "column-docs-nav",
  "column-docs-toc",
  "column-filters",
  "gutter-site",
  "gutter-project",
  "measure",
  "measure-page",
  "measure-lede",
  "top-bar",
  "toolbar",
  "tabs",
] as const;

const PROJECT = "/oscabriel/";

/**
 * Every class the shell draws at an address, the page itself left empty. A
 * project's page sits in the project's frame, which holds its side column.
 */
const shellClasses = (url: string) =>
  renderAt(
    url,
    <AppShell>
      {url.startsWith(PROJECT) ? (
        <ProjectFrame>
          <main id="main" />
        </ProjectFrame>
      ) : (
        <main id="main" />
      )}
    </AppShell>,
    { column: () => <p>Files</p> }
  ).pipe(
    Effect.map((markup) =>
      [...markup.matchAll(/class="(?<classes>[^"]*)"/gu)].flatMap(
        ({ groups }) => groups?.classes?.split(" ") ?? []
      )
    )
  );

describe("DESIGN.md's named values", () => {
  it.effect(
    "frames each shell at its own container and columns, read from the layout tokens",
    () =>
      Effect.gen(function* () {
        const site = yield* shellClasses("/");
        const project = yield* shellClasses("/oscabriel/datekit/tree/main");
        const docs = yield* shellClasses("/docs/answer-an-ask");
        const focus = yield* shellClasses("/import");

        expect(site).toContain("max-w-site");
        expect(project).toStrictEqual(
          expect.arrayContaining(["max-w-project", "w-(--column-tree)"])
        );
        expect(docs).toStrictEqual(
          expect.arrayContaining([
            "max-w-site",
            "columns:grid-cols-[var(--column-docs-nav)_minmax(0,1fr)]",
          ])
        );
        expect(focus).toContain("max-w-focus");
      })
  );

  it.effect(
    "gives each shell its gutter from the layout tokens, which every bar and page inside it reads",
    () =>
      Effect.gen(function* () {
        const site = yield* shellClasses("/");
        const project = yield* shellClasses("/oscabriel/datekit/tree/main");
        const docs = yield* shellClasses("/docs/answer-an-ask");

        expect(site).toContain("[--shell-gutter:var(--gutter-site)]");
        expect(docs).toContain("[--shell-gutter:var(--gutter-site)]");
        expect(project).toContain("[--shell-gutter:var(--gutter-project)]");
        expect(project).not.toContain("[--shell-gutter:var(--gutter-site)]");
        expect(
          [site, project, docs].map((classes) =>
            classes.includes("shell:px-(--shell-gutter)")
          )
        ).toStrictEqual([true, true, true]);
      })
  );

  it("sets a row's state word in ink but for Refused and Landed, as the Mark Carries Rule says", () => {
    const coloured = STATE_MARK_NAMES.filter(
      (mark) => wordTone(mark) !== "text-foreground"
    );

    expect(design).toContain(
      "the state word is ink at 500, except Refused (red) and Landed (green)"
    );
    expect(coloured).toStrictEqual(["landed", "refused", "retry"]);
    expect(coloured.map(wordTone)).toStrictEqual([
      STATE_MARKS.landed.tone,
      STATE_MARKS.refused.tone,
      STATE_MARKS.refused.tone,
    ]);
  });

  it.effect(
    "sets a path's folders muted and its file name in ink in the code header",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/datekit/blob/main/src/parse/week.ts",
          <PathTrail
            path="src/parse/week.ts"
            project={ProjectName.make("oscabriel/datekit")}
            rev="main"
          />
        );

        const folders = [
          ...markup.matchAll(
            /<a\b[^>]*class="(?<classes>[^"]*)"[^>]*>(?:src|parse)<\/a>/gu
          ),
        ].map((match) => match.groups?.classes ?? "");

        expect(folders).toHaveLength(2);
        expect(
          folders.every((classes) =>
            classes.split(" ").includes("text-muted-foreground")
          )
        ).toBeTruthy();
        expect(markup).toMatch(
          /<span aria-current="page" class="[^"]*\btext-foreground\b[^"]*"[^>]*>week\.ts<\/span>/u
        );
      })
  );
});

describe("the overrides' two Don'ts", () => {
  it("reads every source file of the web", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("names no component or class an eyebrow, a kicker or an overline", () => {
    const found = Object.entries(sources).flatMap(([path, source]) =>
      eyebrowsIn(source).map((name) => `${path}: ${name}`)
    );

    expect(found).toStrictEqual([]);
  });

  it("puts no state or primary colour on one edge of a card or row", () => {
    const found = Object.entries(sources).flatMap(([path, source]) =>
      fingernailsIn(source).map((edge) => `${path}: ${edge}`)
    );

    expect(found).toStrictEqual([]);
  });

  it("catches each eyebrow and fingernail it refuses, and lets hairlines and ink rules be", () => {
    expect(
      eyebrowsIn(
        "const SectionEyebrow = () => <p className='kicker overline' />"
      )
    ).toStrictEqual(["Eyebrow", "kicker", "overline"]);
    expect(
      eyebrowsIn("// the kickers kicked; overlined and Overlines are words")
    ).toStrictEqual([]);
    expect(
      fingernailsIn(
        '"border-l-4 border-l-landed" "border-t-2 border-refused" "md:border-l-[3px] border-l-primary/60"'
      )
    ).toStrictEqual(["border-l-4", "border-t-2", "md:border-l-[3px]"]);
    expect(
      fingernailsIn(
        '"border-l-4 border-l-[var(--landed)]" "shadow-[inset_4px_0_0_var(--waiting)]" "hover:shadow-[inset_0_-3px_0] shadow-primary"'
      )
    ).toStrictEqual([
      "border-l-4",
      "shadow-[inset_4px_0_0_var(--waiting)]",
      "hover:shadow-[inset_0_-3px_0]",
    ]);
    expect(
      fingernailsIn(
        '"border-b-2 border-rule-strong" "border-t border-t-refused" "border-l-2 border-rule" "shadow-[inset_0_-2px_0_var(--rule-strong)]" "shadow-[inset_0_0_0_1px_var(--refused)]"'
      )
    ).toStrictEqual([]);
  });
});

describe("DESIGN.md's shells", () => {
  it.each(LAYOUT)("names --%s as styles.css does", (name) => {
    expect(layoutToken(name)).toBeDefined();
    expect(spacing(name)).toBe(layoutToken(name));
  });

  it("tabulates the four shells, each with its container, header and side columns", () => {
    const rows = [
      ...section("Shells").matchAll(/^\| `(?<shell>\w+)` \|/gmu),
    ].map(({ groups }) => groups?.shell);

    expect(rows).toStrictEqual(["site", "project", "docs", "focus"]);
  });

  it("states ADR 0041's four rules, the third as the maintainer amended it: no CLI command on a page", () => {
    const shells = section("Shells");

    expect(shells).toContain("**No global left rail.**");
    expect(shells).toContain("**No generic right rail.**");
    expect(shells).toContain("**No CLI command on a page.**");
    expect(shells).toContain("**Prose stops at 72 to 80ch.**");
  });

  it("holds a page's document and its prose to the measure tokens, never a literal", () => {
    const literal = /max-w-\[(?:[6-8]\dch|56rem)\]/gu;

    const found = Object.entries(sources).flatMap(([path, source]) =>
      [...source.matchAll(literal)].map(([width]) => `${path}: ${width}`)
    );

    expect(found).toStrictEqual([]);
    expect(MEASURE).toBe("max-w-(--measure-page)");
    expect(sources["../src/features/markdown/markdown.tsx"]).toContain(
      "max-w-(--measure)"
    );
  });

  it("drops the old shell's rail, inspector and bottom bar sections", () => {
    expect(design).not.toMatch(
      /^### (?:Rail|Inspector|Top bar and bottom bar)\b/mu
    );
    expect(design).not.toContain("The gate's control room");
  });

  it("keeps the overrides' Don'ts: no fingernail, no eyebrow, the footer's wordmark", () => {
    const rules = section("Do's and Don'ts");

    expect(rules).toContain(
      "**Don't** put a coloured strip, bar, notch or tab on any edge or corner of a card, row or panel"
    );
    expect(rules).toContain("**Don't** set an eyebrow");
    expect(rules).toContain("`Brand.domain`");
  });
});
