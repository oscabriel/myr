/**
 * A project's landings list, rendered to HTML: each landing's subject says
 * what it is and links the ask it answers or the ask it opened; one that
 * did neither reads as what it is. Its credit is one line of roles, never
 * the trailers again.
 */
import { describe, expect, it } from "@effect/vitest";
import type { LandingView } from "@repo/protocol/domain/landing";
import { AskId, LandedSha } from "@repo/protocol/ids";
import { Struct } from "effect";

import { LandingList } from "../src/features/project/landings.tsx";
import { landing, markupOf, now, plainText } from "./ask-fixtures.ts";

/** Every `href` in `markup`, in order. */
const hrefsOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*)"/gu)].map(
    (match) => match.groups?.href ?? ""
  );

/** The markup of the list item for the landing `sha`. */
const itemOf = (markup: string, sha: string) =>
  new RegExp(`<li\\b[^>]*data-landing="${sha}"[^>]*>[\\s\\S]*?</li>`, "u").exec(
    markup
  )?.[0] ?? "";

/** `landing` without the ask it answers: a decider's own landing. */
const unasked: LandingView = {
  ...Struct.omit(landing, ["ask"]),
  sha: LandedSha.make("e".repeat(40)),
};

/** An ask's opening: it opened `format-ordinal` and answers nothing. */
const opening: LandingView = {
  ...unasked,
  opened: AskId.make("format-ordinal"),
  sha: LandedSha.make("f".repeat(40)),
};

const markup = markupOf(
  <LandingList landings={[landing, opening, unasked]} now={now} />
);

describe("a project's landings list", () => {
  it('reads an opening as "Open ask <id>", linking the ask it opened', () => {
    const item = itemOf(markup, opening.sha);

    expect(plainText(item)).toContain("Open ask format-ordinal");
    expect(plainText(item)).not.toContain("Landed without an ask");
    expect(hrefsOf(item)).toContain("/datekit/asks/format-ordinal");
  });

  it("reads a landing that answers an ask as its answer, linking the ask", () => {
    const item = itemOf(markup, landing.sha);

    expect(plainText(item)).toContain("Answer parse-iso-week");
    expect(hrefsOf(item)).toContain("/datekit/asks/parse-iso-week");
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
