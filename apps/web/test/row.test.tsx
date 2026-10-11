/**
 * One row for every list: the thing's own words are the link (never its
 * id), its metadata on a second line with nothing meaningless in it, its
 * state as a word at the right, and its command as text a crawler and a
 * screen reader read, inside the row's copy button. Rendered inside the
 * app's router, as the lists are.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { AskListing } from "@repo/protocol/domain/ask";
import { Outcome } from "@repo/protocol/domain/outcome";
import { CommitSha, Handle, ProjectName } from "@repo/protocol/ids";
import { StaleBase } from "@repo/protocol/refusal";
import { DateTime, Effect, Schema } from "effect";
import type { ReactElement } from "react";

import { STATE_MARKS } from "../src/features/shared/marks.tsx";
import { AskRow, Row, RowGroup } from "../src/features/shared/row.tsx";
import { attributeOf, tagsWith, textIn } from "./markup.ts";
import { renderAt } from "./render.tsx";

const burrow = ProjectName.make("burrow");

const listing = (territory: string) =>
  Schema.decodeSync(AskListing)({
    ask: "fix-week-start",
    blockedBy: [],
    claimed: false,
    kind: "bug",
    territory,
    want: "A week starts on the locale's first day, not always on Sunday.",
  });

const rowsAt = (element: ReactElement) => renderAt("/", <ul>{element}</ul>);

/** Each anchor in `markup`, as `[href, text]`. */
const anchors = (markup: string) =>
  [...markup.matchAll(/<a\b(?<attributes>[^>]*)>(?<body>.*?)<\/a>/gsu)].map(
    (match) => [
      attributeOf(match.groups?.attributes ?? "", "href"),
      textIn(match.groups?.body ?? ""),
    ]
  );

describe(AskRow, () => {
  it.effect("links the want, never the id, to the ask's page", () =>
    Effect.gen(function* () {
      const markup = yield* rowsAt(
        <AskRow listing={listing("@burrow/auth")} project={burrow} takeable />
      );

      expect(anchors(markup)).toContainEqual([
        "/burrow/asks/fix-week-start",
        "A week starts on the locale's first day, not always on Sunday.",
      ]);
      expect(
        anchors(markup).some(([, text]) => text === "fix-week-start")
      ).toBeFalsy();
      expect(markup).toContain(
        `title="A week starts on the locale&#x27;s first day, not always on Sunday."`
      );
    })
  );

  it.effect("leaves a whole-repo territory out of the second line", () =>
    Effect.gen(function* () {
      const whole = textIn(
        yield* rowsAt(
          <AskRow listing={listing(".")} project={burrow} takeable />
        )
      );

      const module = textIn(
        yield* rowsAt(
          <AskRow listing={listing("@burrow/auth")} project={burrow} takeable />
        )
      );

      expect(whole).not.toContain("Territory");
      expect(whole).not.toMatch(/·\s*\.\s*(?:·|$)/u);
      expect(module).toContain("bug · @burrow/auth · fix-week-start");
    })
  );

  it.effect(
    "holds the claim command as text inside its copy button, named for what it copies",
    () =>
      Effect.gen(function* () {
        const markup = yield* rowsAt(
          <AskRow listing={listing("@burrow/auth")} project={burrow} takeable />
        );

        const command = `${Brand.cli} claim fix-week-start --project burrow`;

        expect(markup).toMatch(
          new RegExp(
            `<button\\b[^>]*aria-label="Copy claim command"[^>]*>.*<code class="sr-only">${command}</code>.*</button>`,
            "su"
          )
        );
      })
  );

  it.effect(
    "carries the ask, its project and whether the viewer may take it on the row itself",
    () =>
      Effect.gen(function* () {
        const markup = yield* rowsAt(
          <AskRow listing={listing("@burrow/auth")} project={burrow} takeable />
        );

        const [row] = tagsWith(markup, "data-ask");

        expect(row).toMatch(/^<li\b/u);
        expect(attributeOf(row ?? "", "data-ask")).toBe("fix-week-start");
        expect(attributeOf(row ?? "", "data-project")).toBe("burrow");
        expect(attributeOf(row ?? "", "data-takeable")).toBe("true");
      })
  );

  it.effect(
    "says an ask it may take is open to take, and gives one it may not no command",
    () =>
      Effect.gen(function* () {
        const open = textIn(
          yield* rowsAt(
            <AskRow
              listing={listing("@burrow/auth")}
              project={burrow}
              takeable
            />
          )
        );

        const held = yield* rowsAt(
          <AskRow
            listing={{ ...listing("@burrow/auth"), claimed: true }}
            project={burrow}
            takeable={false}
          />
        );

        expect(open).toContain("Open to take");
        expect(textIn(held)).toContain("Claimed");
        expect(held).not.toContain("Copy claim command");
      })
  );
  it.effect(
    "draws a refusal's word in the refused role even when it can be retried, its mark apart",
    () =>
      Effect.gen(function* () {
        const markup = yield* rowsAt(
          <AskRow
            listing={listing("@burrow/auth")}
            progress={{
              lastSeq: 2,
              latest: Outcome.cases.Refused.make({
                refusals: [
                  new StaleBase({
                    base: CommitSha.make("a".repeat(40)),
                    conflicts: [],
                    main: CommitSha.make("b".repeat(40)),
                  }),
                ],
              }),
              rounds: [],
            }}
            project={burrow}
          />
        );

        const words = [
          ...markup.matchAll(/<span class="(?<classes>[^"]*)">Refused</gu),
        ].map((match) => match.groups?.classes ?? "");

        expect(words.length).toBeGreaterThan(0);

        for (const classes of words) {
          expect(classes).toContain("text-refused");
          expect(classes).not.toContain("text-waiting");
        }
      })
  );
});

/** The classes on each element whose text is `word`, in `markup`. */
const wordClasses = (markup: string, word: string) =>
  [
    ...markup.matchAll(
      new RegExp(`<span class="(?<classes>[^"]*)">${word}<`, "gu")
    ),
  ].map((match) => match.groups?.classes ?? "");

describe("an ask row's standing, word and time", () => {
  const now = DateTime.makeUnsafe("2026-10-11T12:00:00Z");
  const held = { ...listing("@burrow/auth"), reserve: "newcomers" } as const;

  it.effect(
    "reads an ask held for newcomers as held for them, whether or not the viewer may take it",
    () =>
      Effect.gen(function* () {
        const refused = textIn(
          yield* rowsAt(
            <AskRow listing={held} project={burrow} takeable={false} />
          )
        );

        const unknown = textIn(
          yield* rowsAt(<AskRow listing={held} project={burrow} />)
        );

        expect(refused).toContain("Held for newcomers");
        expect(refused).not.toContain("Not open to you");
        expect(unknown).toContain("Held for newcomers");
      })
  );

  it.effect(
    "sets a waiting word in ink, its colour on the mark alone, and keeps Landed green",
    () =>
      Effect.gen(function* () {
        const waiting = yield* rowsAt(
          <AskRow
            listing={{ ...listing("@burrow/auth"), blockedBy: [held.ask] }}
            project={burrow}
          />
        );

        const landed = yield* rowsAt(
          <Row
            href="/burrow/asks/a"
            id="a"
            state={{ mark: "landed", word: "Landed" }}
            title="Format ordinals"
          />
        );

        expect(wordClasses(waiting, "Waiting").length).toBeGreaterThan(0);
        expect(wordClasses(waiting, "Waiting").join(" ")).not.toContain(
          STATE_MARKS.waiting.tone
        );
        expect(waiting).toMatch(/<svg\b[^>]*text-waiting/u);
        expect(wordClasses(landed, "Landed").join(" ")).toContain(
          "text-landed"
        );
      })
  );

  it.effect(
    "fills the time slot with the last push, and names the round in line 2",
    () =>
      Effect.gen(function* () {
        const at = DateTime.subtract(now, { hours: 3 });
        const head = CommitSha.make("c".repeat(40));

        const markup = yield* rowsAt(
          <AskRow
            listing={listing("@burrow/auth")}
            now={now}
            progress={{
              claimant: Handle.make("bram"),
              lastPush: { at, head },
              lastSeq: 4,
              rounds: [
                {
                  at,
                  head,
                  outcome: Outcome.cases.Checking.make({ stage: "checks" }),
                  seq: 3,
                },
                {
                  at,
                  head,
                  outcome: Outcome.cases.Checking.make({ stage: "checks" }),
                  seq: 4,
                },
              ],
            }}
            project={burrow}
          />
        );

        expect(markup).toMatch(
          new RegExp(
            `<time dateTime="${DateTime.formatIso(at)}"[^>]*>3 h ago</time>`,
            "u"
          )
        );
        expect(textIn(markup)).toContain("round 2");
      })
  );

  it.effect(
    "fills the time slot with the ask's opening when nothing was pushed",
    () =>
      Effect.gen(function* () {
        const opened = DateTime.subtract(now, { days: 2 });

        const markup = yield* rowsAt(
          <AskRow
            listing={listing("@burrow/auth")}
            now={now}
            progress={{ lastSeq: 1, opened, rounds: [] }}
            project={burrow}
            takeable
          />
        );

        expect(textIn(markup)).toContain("2 d ago");
      })
  );

  it.effect(
    "gives a selected row the pressed surface under the pointer, and lets the want take two lines on a phone",
    () =>
      Effect.gen(function* () {
        const markup = yield* rowsAt(
          <Row
            data={{ "data-ask": "a" }}
            href="/burrow/asks/a"
            id="a"
            selected
            title="Format ordinals"
          />
        );

        const [row] = tagsWith(markup, "data-ask");

        const want = /<p class="(?<classes>[^"]*)"><a\b/u.exec(markup)?.groups
          ?.classes;

        expect(attributeOf(row ?? "", "class")?.split(" ")).toStrictEqual(
          expect.arrayContaining(["bg-surface", "hover:bg-surface-2"])
        );
        expect(want?.split(" ")).toStrictEqual(
          expect.arrayContaining(["line-clamp-2", "tablet:line-clamp-1"])
        );
      })
  );
});

describe(Row, () => {
  it.effect(
    "puts the state's word beside its mark, and keeps the mark from the screen reader",
    () =>
      Effect.gen(function* () {
        const markup = yield* rowsAt(
          <Row
            href="/datekit/asks/a"
            id="a"
            state={{ mark: "landed", word: "Landed" }}
            title="Format ordinals"
          />
        );

        expect(textIn(markup)).toContain("Landed");
        expect(markup).toMatch(/<svg\b[^>]*aria-hidden="true"/u);
      })
  );

  it.effect(
    "marks the selected row, and gives j and k its link to move to",
    () =>
      Effect.gen(function* () {
        const markup = yield* rowsAt(
          <Row href="/datekit/asks/a" id="a" selected title="Format ordinals" />
        );

        expect(markup).toContain('data-selected="true"');
        expect(markup).toContain('data-list-key="a"');
      })
  );

  it.effect(
    "keeps the whole row the link's to press when the list does not select, at every width",
    () =>
      Effect.gen(function* () {
        const plain = yield* rowsAt(
          <Row href="/datekit/asks/a" id="a" title="Format ordinals" />
        );

        const selecting = yield* rowsAt(
          <Row
            href="/datekit/asks/a"
            id="a"
            onSelect={() => {}}
            title="Format ordinals"
          />
        );

        const [link] = tagsWith(plain, "data-list-key");
        const [selectingLink] = tagsWith(selecting, "data-list-key");

        expect(link).not.toContain("shell:after:pointer-events-none");
        expect(selectingLink).toContain("shell:after:pointer-events-none");
      })
  );

  it.effect(
    "keeps its raised controls inside its own layer, under the sticky headers",
    () =>
      Effect.gen(function* () {
        const markup = yield* rowsAt(
          <Row
            action={<button type="button">Copy</button>}
            data={{ "data-ask": "a" }}
            href="/datekit/asks/a"
            id="a"
            title="Format ordinals"
          />
        );

        const [row] = tagsWith(markup, "data-ask");

        expect(attributeOf(row ?? "", "class")?.split(" ")).toContain(
          "isolate"
        );
      })
  );

  it.effect("heads a group with its name as a link and its counts", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt(
        "/",
        <RowGroup
          counts="7 open · 6 to take"
          name={<a href="/datekit">datekit</a>}
        >
          <Row href="/datekit/asks/a" id="a" title="Format ordinals" />
        </RowGroup>
      );

      expect(textIn(markup)).toContain("datekit");
      expect(textIn(markup)).toContain("7 open · 6 to take");
    })
  );
});
