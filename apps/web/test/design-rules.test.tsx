/**
 * DESIGN.md's named values, held against the components that draw them:
 * the inspector's widths (its `spacing` tokens) and the row's state word
 * (the Mark Carries Rule), and a path's file name read before its
 * folders. A change to either side without the other
 * fails here, so the document and the web never drift apart.
 */
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

/** A `spacing` token's value in DESIGN.md's frontmatter. */
const spacing = (name: string) =>
  new RegExp(`^ {2}${name}: "(?<value>[^"]+)"$`, "mu").exec(design)?.groups
    ?.value;

/** The inspector's class list, as a page with facts draws it. */
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
