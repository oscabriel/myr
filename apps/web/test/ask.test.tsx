/**
 * The ask page, as a person reads it: the brief (want, current behaviour,
 * out of scope, terms, context), its kind, territory, check and state, who
 * asked, its parent and blockers, and the exact lines that clone, claim and
 * check it. Rendered to HTML with `react-dom/server`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { AskId, Handle } from "@repo/protocol/ids";
import { UnknownAsk } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Schema } from "effect";

import { AskView } from "../src/features/ask/ask-page.tsx";
import { NotFoundView, Refusals } from "../src/features/ask/refused.tsx";
import {
  ask,
  askId,
  brief,
  inOrder,
  markupOf,
  now,
  textOf,
} from "./ask-fixtures.ts";

const platformUrl = "https://platform-test.example.workers.dev";

const page = (shown = ask) => (
  <AskView ask={shown} brief={brief} now={now} platformUrl={platformUrl} />
);

describe(AskView, () => {
  it("titles the page with the want, then reads the brief's sections in order", () => {
    const markup = markupOf(page());

    expect(markup).toMatch(
      /<h1\b[^>]*>Parse ISO week dates like 2026-W41-3<\/h1>/u
    );
    expect(
      inOrder(textOf(page()), [
        "Current behaviour",
        "parseWeek returns null for 2026-W41-3.",
        "Out of scope",
        "Formatting week dates back to strings.",
        "Terms",
        "Week date: a date written as year, week and weekday.",
        "Context",
        "ISO 8601 numbers weeks from the Monday of the week holding 4 January.",
      ])
    ).toBeTruthy();
  });

  it("leaves out a section the brief does not have", () => {
    const text = textOf(
      page({ ...ask, brief: { want: "Parse ISO week dates like 2026-W41-3" } })
    );

    expect(text).not.toContain("Current behaviour");
    expect(text).not.toContain("Out of scope");
    expect(text).not.toContain("Terms");
  });

  it("gives the ask's name, kind, state and check", () => {
    expect(
      inOrder(textOf(page()), [
        "Ask",
        askId,
        "State",
        "Open",
        "Kind",
        "fix",
        "Check",
        "test/parse-week.test.ts",
      ])
    ).toBeTruthy();
  });

  it("gives the ask's territory, and who asked it when", () => {
    const text = textOf(page());

    expect(
      inOrder(text, ["Asked by", "ines-v", "opened 2 d ago"])
    ).toBeTruthy();
    expect(
      inOrder(text, ["Territory", "@datekit/parse", "packages/parse/**"])
    ).toBeTruthy();
    expect(markupOf(page())).toContain('href="/people/ines-v"');
  });

  it("gives the lines that clone the project, claim the ask and check an answer, with the CLI's own name", () => {
    expect(
      inOrder(textOf(page()), [
        `git clone ${platformUrl}/datekit.git`,
        `${Brand.cli} claim ${askId} --project datekit`,
        `${Brand.cli} check --ask ${askId}`,
      ])
    ).toBeTruthy();
  });

  it("names the asks a blocked ask waits on, each linking to its page", () => {
    const blocked = {
      ...ask,
      blockedBy: [AskId.make("split-format"), AskId.make("split-parse")],
    };

    const text = textOf(page(blocked));
    const markup = markupOf(page(blocked));

    expect(
      inOrder(text, [
        "Waits on",
        "split-format",
        "split-parse",
        "to land first",
      ])
    ).toBeTruthy();
    expect(markup).toContain('href="/datekit/asks/split-format"');
    expect(markup).toContain('href="/datekit/asks/split-parse"');
  });

  it("names nothing it waits on when nothing blocks it", () => {
    expect(textOf(page())).not.toContain("Waits on");
  });

  it("links a step of a migrate to its parent ask", () => {
    const child = { ...ask, parent: AskId.make("migrate-week-api") };

    expect(markupOf(page(child))).toContain(
      'href="/datekit/asks/migrate-week-api"'
    );
  });

  it("says when an ask is held for newcomers, and who mentors them", () => {
    const held = {
      ...ask,
      mentor: Handle.make("okonkwo"),
      reserve: "newcomers" as const,
    };

    const text = textOf(page(held));

    expect(text).toContain("Held for newcomers");
    expect(markupOf(page(held))).toContain('href="/people/okonkwo"');
  });

  it("gives no claim line once the ask is closed", () => {
    const text = textOf(page({ ...ask, state: "closed" }));

    expect(text).toContain("Closed");
    expect(text).not.toContain(`${Brand.cli} claim`);
  });

  it("links to the ask's Markdown and to the verdict on its latest answer", () => {
    const markup = markupOf(page());

    expect(markup).toContain(`href="/datekit/asks/${askId}.md"`);
    expect(markup).toContain(`href="/datekit/answers/${askId}"`);
  });

  it("shows the brief exactly as an agent reads it", () => {
    expect(textOf(page())).toContain(
      textOf(<pre>{brief}</pre>)
        .trim()
        .slice(0, 60)
    );
  });
});

describe(NotFoundView, () => {
  it("shows the refusal a not-found carried from the server, as git printed it", () => {
    const refusal = new UnknownAsk({ ask: AskId.make("no-such-ask") });

    // The refusal crosses from the server encoded, as a loader's not-found carries it.
    const carried = Schema.decodeUnknownSync(Refusals)(
      structuredClone(Schema.encodeSync(Refusals)([refusal]))
    );

    const text = textOf(
      <NotFoundView refusals={carried} title="No such ask" />
    );

    expect(
      inOrder(text, [
        "No such ask",
        ...explain([refusal]).map((line) => line.trim()),
        `${Brand.cli} asks`,
      ])
    ).toBeTruthy();
  });

  it("says nothing is at an address that names no ask at all", () => {
    expect(
      textOf(<NotFoundView refusals={undefined} title="No such ask" />)
    ).toContain("Nothing is at this address");
  });
});
