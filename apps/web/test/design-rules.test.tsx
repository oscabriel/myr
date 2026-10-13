import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import design from "../../../DESIGN.md?raw";
import { PathTrail } from "../src/features/code/file-header.tsx";
import {
  STATE_MARK_NAMES,
  STATE_MARKS,
} from "../src/features/shared/marks.tsx";
import { wordTone } from "../src/features/shared/row.tsx";
import { Workspace } from "../src/features/shared/shell/workspace.tsx";
import { renderAt } from "./render.tsx";

const sources: Readonly<Record<string, string>> = import.meta.glob(
  "../src/**/*.{ts,tsx,css}",
  { eager: true, import: "default", query: "?raw" }
);

/** A small, tracked line above a headline, by any of its usual names. */
const EYEBROW = /eyebrow|kicker|overline/giu;

const eyebrowsIn = (source: string) =>
  [...source.matchAll(EYEBROW)].map(([name]) => name);

const EDGE_COLOURS =
  "landed|checking|waiting|refused|sealed|primary|destructive";

const thickEdge =
  /(?<![\w-])(?:[\w-]+:)*border-(?<edge>[lrtbse])-(?<width>\d+|\[[\d.]+(?:px|rem)\])(?![\w-])/gu;

const colouredEdge = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*border-(?<edge>[lrtbse])-(?:${EDGE_COLOURS})(?:/\\d+)?(?![\\w-])`,
  "gu"
);

const colouredBorder = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*border-(?:${EDGE_COLOURS})(?:/\\d+)?(?![\\w-])`,
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
 * classes or on the same edge anywhere in the file.
 */
const fingernailsIn = (source: string) => {
  const literals = source.match(/"[^"]*"|'[^']*'|`[^`]*`/gu) ?? [];

  const coloured = new Set(
    [...source.matchAll(colouredEdge)].map(({ groups }) => groups?.edge)
  );

  return literals.flatMap((literal) =>
    [...literal.matchAll(thickEdge)].flatMap(({ 0: found, groups }) =>
      pixels(groups?.width ?? "0") > 1 &&
      (coloured.has(groups?.edge) || colouredBorder.test(literal))
        ? [found]
        : []
    )
  );
};

const spacing = (name: string) =>
  new RegExp(`^ {2}${name}: "(?<value>[^"]+)"$`, "mu").exec(design)?.groups
    ?.value;

const inspectorClasses = (code: boolean) => {
  const markup = renderToStaticMarkup(
    <Workspace
      crumbs={[{ label: "Ledger" }]}
      facts={<p>Posture: open</p>}
      factsHeading="This ledger"
      title="Ledger"
      variant={code ? "code" : "document"}
    >
      <p>Entries</p>
    </Workspace>
  );

  const aside =
    /<aside\b[^>]*data-facts="inspector"[^>]*>/u.exec(markup)?.[0] ?? "";

  return (
    /class="(?<classes>[^"]*)"/u.exec(aside)?.groups?.classes ?? ""
  ).split(" ");
};

describe("DESIGN.md's named values", () => {
  it("sizes the inspector as the spacing tokens say, wider from codefacts", () => {
    const narrow = spacing("inspector");
    const wide = spacing("inspector-codefacts");

    expect([narrow, wide]).toStrictEqual(["20rem", "22rem"]);
    expect(inspectorClasses(false)).toStrictEqual(
      expect.arrayContaining([`w-[${narrow}]`, `codefacts:w-[${wide}]`])
    );
    expect(inspectorClasses(true)).toStrictEqual(
      expect.arrayContaining([`codefacts:w-[${wide}]`])
    );
  });

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
      fingernailsIn(
        '"border-l-4 border-l-landed" "border-t-2 border-refused" "md:border-l-[3px] border-l-primary/60"'
      )
    ).toStrictEqual(["border-l-4", "border-t-2", "md:border-l-[3px]"]);
    expect(
      fingernailsIn(
        '"border-b-2 border-rule-strong" "border-t border-t-refused" "border-l-2 border-rule"'
      )
    ).toStrictEqual([]);
  });
});
