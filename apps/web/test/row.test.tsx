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
import { CommitSha, ProjectName } from "@repo/protocol/ids";
import { StaleBase } from "@repo/protocol/refusal";
import { Effect, Schema } from "effect";
import type { ReactElement } from "react";

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
