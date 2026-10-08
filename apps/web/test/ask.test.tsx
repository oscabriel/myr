/**
 * The ask page, as a person reads it: the brief (want, current behaviour,
 * out of scope, terms, context), its kind, territory, check and state, who
 * asked, its parent and blockers, and the exact lines that clone, claim and
 * check it. Rendered to HTML with `react-dom/server`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { AskId, Handle } from "@repo/protocol/ids";
import { UnknownAsk } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { Effect, Layer, Ref, Schema } from "effect";
import { RpcTest } from "effect/rpc";

import { AskView } from "../src/features/ask/ask-page.tsx";
import { NoSuchAsk, Refusals } from "../src/features/ask/refused.tsx";
import { readAsk } from "../src/routes/$project/asks/$ask.tsx";
import {
  ask,
  askId,
  brief,
  inOrder,
  markupOf,
  now,
  project,
  textOf,
} from "./ask-fixtures.ts";

const platformUrl = "https://platform-test.example.workers.dev";

/** The markup inside the first `<pre>`. */
const inPre = (markup: string) =>
  /<pre\b[^>]*>(?<inner>.*?)<\/pre>/su.exec(markup)?.groups?.inner;

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
    expect(inPre(markupOf(page()))).toBe(inPre(markupOf(<pre>{brief}</pre>)));
  });
});

describe(NoSuchAsk, () => {
  it("shows the refusal a loader's not-found carried from the server, as git printed it", () => {
    const refusal = new UnknownAsk({ ask: AskId.make("no-such-ask") });

    // The not-found's data, as it crosses from the server: encoded, then cloned.
    const data = structuredClone(Schema.encodeSync(Refusals)([refusal]));

    expect(
      inOrder(textOf(<NoSuchAsk data={data} />), [
        "No such ask",
        ...explain([refusal]).map((line) => line.trim()),
        `${Brand.cli} asks`,
      ])
    ).toBeTruthy();
  });

  it("says nothing is at an address that names no ask at all", () => {
    expect(textOf(<NoSuchAsk />)).toContain("Nothing is at this address");
  });

  it("says what its route gives it when a not-found carries no refusal", () => {
    expect(
      textOf(<NoSuchAsk nothing="No answer is at this head." />)
    ).toContain("No answer is at this head.");
  });
});

/** A platform that knows datekit's one ask, counting `showAsk` calls. */
const platformOf = (calls: Ref.Ref<number>) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("showAsk", (payload) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (count) => count + 1);

            if (payload.ask !== askId) {
              return yield* new UnknownAsk({ ask: payload.ask });
            }

            return { ask, brief };
          })
        )
      ),
      asTester,
    ])
  );

describe(readAsk, () => {
  it.effect("reads the ask and its brief for the page", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);

      const read = yield* readAsk({ ask: askId, project }).pipe(
        Effect.provide(platformOf(calls))
      );

      expect([read.ask.id, read.brief]).toStrictEqual([askId, brief]);
      expect(yield* Ref.get(calls)).toBe(1);
    })
  );

  it.effect(
    "is a not-found carrying the UnknownAsk refusal for an ask the project lacks",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        const missing = AskId.make("no-such-ask");

        const failed = yield* Effect.flip(
          readAsk({ ask: missing, project }).pipe(
            Effect.provide(platformOf(calls))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();

        const carried = yield* Schema.decodeUnknownEffect(Refusals)(
          isNotFound(failed) ? failed.data : undefined
        );

        expect(explain(carried)).toStrictEqual(
          explain([new UnknownAsk({ ask: missing })])
        );
      })
  );

  it.effect(
    "is a not-found with no refusal, and asks nothing, for a name no ask can have",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);

        const failed = yield* Effect.flip(
          readAsk({ ask: "Not_An-Ask", project }).pipe(
            Effect.provide(platformOf(calls))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();
        expect(
          isNotFound(failed) ? failed.data : "not a not-found"
        ).toBeUndefined();
        expect(yield* Ref.get(calls)).toBe(0);
      })
  );
});
