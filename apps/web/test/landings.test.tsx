import { describe, expect, it } from "@effect/vitest";
import type { LandingView } from "@repo/protocol/domain/landing";
import { AskId, LandedSha } from "@repo/protocol/ids";
import { Struct } from "effect";

import { LandingList } from "../src/features/project/landings.tsx";
import { landing, markupOf, now, plainText } from "./ask-fixtures.ts";

const hrefsOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*)"/gu)].map(
    (match) => match.groups?.href ?? ""
  );

const itemOf = (markup: string, sha: string) =>
  new RegExp(`<li\\b[^>]*data-landing="${sha}"[^>]*>[\\s\\S]*?</li>`, "u").exec(
    markup
  )?.[0] ?? "";

const unasked: LandingView = {
  ...Struct.omit(landing, ["ask"]),
  sha: LandedSha.make("e".repeat(40)),
};

const opening: LandingView = {
  ...unasked,
  opened: AskId.make("format-ordinal"),
  sha: LandedSha.make("f".repeat(40)),
};

const markup = markupOf(
  <LandingList landings={[landing, opening, unasked]} now={now} />
);

describe("a project's landings list", () => {
  it('reads an opening as "Opened ask <id>", linking the ask it opened', () => {
    const item = itemOf(markup, opening.sha);

    expect(plainText(item)).toContain("Opened ask format-ordinal");
    expect(plainText(item)).not.toContain("Open ask format-ordinal");
    expect(plainText(item)).not.toContain("Landed without an ask");
    expect(hrefsOf(item)).toContain("/oscabriel/datekit/asks/format-ordinal");
  });

  it("reads a landing that answers an ask as its answer, linking the ask", () => {
    const item = itemOf(markup, landing.sha);

    expect(plainText(item)).toContain("Answer parse-iso-week");
    expect(hrefsOf(item)).toContain("/oscabriel/datekit/asks/parse-iso-week");
  });

  it("still reads a landing with neither as landed without an ask, linking none", () => {
    const item = itemOf(markup, unasked.sha);

    expect(plainText(item)).toContain("Landed without an ask");
    expect(
      hrefsOf(item).filter((href) => href.includes("/asks/"))
    ).toStrictEqual([]);
  });
});

describe("a landing's credit in the list", () => {
  it("is one line of roles in trailer order, each person linked, with no trailer lines", () => {
    const item = itemOf(markup, landing.sha);
    const credit = plainText(item);

    expect(credit).toMatch(/Asked by ines-v[\s\S]*answered by okafor/u);
    expect(credit).not.toContain("Asked-by:");
    expect(hrefsOf(item)).toContain("/people/ines-v");
  });
});
