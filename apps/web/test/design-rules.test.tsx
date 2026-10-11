/**
 * DESIGN.md's named values, held against the components that draw them:
 * the inspector's widths (its `spacing` tokens) and the row's state word
 * (the Mark Carries Rule). A change to either side without the other
 * fails here, so the document and the web never drift apart.
 */
import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Workspace } from "../src/features/shared/shell/workspace.tsx";

import design from "../../../DESIGN.md?raw";

/** A `spacing` token's value in DESIGN.md's frontmatter. */
const spacing = (name: string) =>
  new RegExp(`^ {2}${name}: "(?<value>[^"]+)"$`, "mu").exec(design)?.groups
    ?.value;

/** The inspector's class list, as a page with facts draws it. */
const inspectorClasses = (code: boolean) => {
  const markup = renderToStaticMarkup(
    <Workspace
      code={code}
      crumbs={[{ label: "Ledger" }]}
      facts={<p>Posture: open</p>}
      factsHeading="This ledger"
      title="Ledger"
    >
      <p>Entries</p>
    </Workspace>
  );

  return (
    /<aside\b[^>]*data-facts="inspector"[^>]*>/u
      .exec(markup)?.[0]
      .match(/class="(?<classes>[^"]*)"/u)
      ?.groups?.classes.split(" ") ?? []
  );
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
});
