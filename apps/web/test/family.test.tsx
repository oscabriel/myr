/**
 * A family drawn as a fan: one node per child the parent stores, each its
 * mark and its short name, an arrow to the delete child that waits on
 * them, and "n of N landed" counted against the stored children, never the
 * listing's remaining ones. A child that landed while the page was open
 * settles with the stamp, once. Its states come from the event fold, built
 * here from hand-made events.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { Ask } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  Handle,
  LandedSha,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import { OutOfScope } from "@repo/protocol/refusal";
import { DateTime, Effect } from "effect";

import { askStates } from "../src/features/shared/ask-progress.ts";
import { FamilyStrip, FamilyTree } from "../src/features/shared/family.tsx";
import { ask as fixture } from "./ask-fixtures.ts";
import { attributeOf, tagsWith, textIn } from "./markup.ts";
import { renderAt } from "./render.tsx";

const burrow = ProjectName.make("oscabriel/burrow");

const at = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const id = (name: string) => AskId.make(`drop-legacy-fetch-${name}`);

const modules = [
  "auth",
  "billing",
  "catalog",
  "kit",
  "notify",
  "search",
] as const;

const children = modules.map((name) => id(`burrow-${name}`));

const finale = id("delete");

const parent: Ask = {
  ...fixture,
  blockedBy: [...children, finale],
  id: AskId.make("drop-legacy-fetch"),
  project: burrow,
};

const sha = LandedSha.make("e".repeat(40));

const tamsin = Handle.make("tamsin");

const states = askStates([
  ProjectEvent.cases.Claimed.make({
    ask: id("burrow-auth"),
    at,
    claimant: tamsin,
    seq: 1,
  }),
  ProjectEvent.cases.AskClosed.make({
    ask: id("burrow-auth"),
    at,
    landing: sha,
    seq: 2,
  }),
  ProjectEvent.cases.AskClosed.make({
    ask: id("burrow-billing"),
    at,
    landing: sha,
    seq: 3,
  }),
  ProjectEvent.cases.Claimed.make({
    ask: id("burrow-catalog"),
    at,
    claimant: tamsin,
    seq: 4,
  }),
  ProjectEvent.cases.Claimed.make({
    ask: id("burrow-kit"),
    at,
    claimant: Handle.make("bram"),
    seq: 5,
  }),
  ProjectEvent.cases.Judged.make({
    ask: id("burrow-kit"),
    at,
    head: fixture.openedIn,
    outcome: Outcome.cases.Refused.make({
      refusals: [new OutOfScope({ paths: [RepoPath.make("README.md")] })],
    }),
    seq: 6,
  }),
]);

const strip = (props: {
  readonly expanded: boolean;
  readonly stamps?: ReadonlySet<AskId>;
}) =>
  renderAt(
    "/oscabriel/burrow",
    <FamilyStrip
      expanded={props.expanded}
      finale={finale}
      parent={parent}
      project={burrow}
      stamps={props.stamps ?? new Set()}
      states={states}
    />
  );

/** The `<li>`s of the list named `label`, each as its text. */
const itemsOf = (markup: string, label: string) => {
  const start = markup.indexOf(`aria-label="${label}"`);
  const end = markup.indexOf("</ol>", start);

  return [
    ...markup.slice(start, end).matchAll(/<li\b[^>]*>(?<body>.*?)<\/li>/gsu),
  ].map((match) => textIn(match.groups?.body ?? "").trim());
};

describe(FamilyStrip, () => {
  it.effect(
    "names each stored child by its short name and its state, in the parent's order",
    () =>
      Effect.gen(function* () {
        const markup = yield* strip({ expanded: false });

        expect(markup).toMatch(
          /<ol\b[^>]*aria-label="drop-legacy-fetch&#x27;s children"/u
        );
        expect(
          itemsOf(markup, "drop-legacy-fetch&#x27;s children")
        ).toStrictEqual([
          "auth, landed",
          "billing, landed",
          "catalog, claimed",
          "kit, refused",
          "notify, open",
          "search, open",
        ]);
      })
  );

  it.effect(
    "counts landings against the stored children, and says what the delete child waits for",
    () =>
      Effect.gen(function* () {
        const text = textIn(yield* strip({ expanded: false }));

        expect(text).toContain("2 of 6 landed");
        expect(text).toContain("delete waits for 4");
      })
  );

  it.effect("links each node to its child's ask", () =>
    Effect.gen(function* () {
      const markup = yield* strip({ expanded: false });

      for (const child of children) {
        expect(markup).toContain(`href="/oscabriel/burrow/asks/${child}"`);
      }
    })
  );

  it.effect("stamps only a child that landed while the page was open", () =>
    Effect.gen(function* () {
      const markup = yield* strip({
        expanded: false,
        stamps: new Set([id("burrow-billing")]),
      });

      const stamped = tagsWith(markup, "class").filter((tag) =>
        tag.includes("animate-stamp")
      );

      expect(stamped).toHaveLength(1);
      expect(markup.match(/animate-stamp/gu)).toHaveLength(1);

      const node = markup.slice(
        markup.indexOf(`href="/oscabriel/burrow/asks/${id("burrow-billing")}"`)
      );

      expect(node.indexOf("animate-stamp")).toBeLessThan(node.indexOf("</a>"));
    })
  );

  it.effect("folds the children away behind a button that says how many", () =>
    Effect.gen(function* () {
      const folded = yield* strip({ expanded: false });

      expect(textIn(folded)).toContain("Show 6 children");
      expect(folded).toMatch(/<button\b[^>]*aria-expanded="false"/u);
      // Folded, the rows are out of sight and out of the reading order:
      // the list that holds them is hidden.
      expect(folded).toMatch(
        /<ul\b[^>]*hidden=""[^>]*>(?:(?!<\/ul>).)*data-family-child/su
      );
      expect(folded).not.toMatch(
        /<ul\b(?![^>]*hidden="")[^>]*>(?:(?!<\/ul>).)*data-family-child/su
      );
    })
  );

  it.effect(
    "holds each open child's claim command as text, folded or not",
    () =>
      Effect.gen(function* () {
        for (const expanded of [false, true]) {
          const markup = yield* strip({ expanded });

          for (const open of ["burrow-notify", "burrow-search"]) {
            expect(markup).toContain(
              `<code class="sr-only">${Brand.cli} claim ${id(open)} --project oscabriel/burrow</code>`
            );
          }

          // A child someone holds, or that landed, has none.
          expect(markup).not.toContain(`claim ${id("burrow-catalog")} `);
          expect(markup).not.toContain(`claim ${id("burrow-auth")} `);
        }
      })
  );

  it.effect(
    "lists the children as rows when expanded, the delete child apart",
    () =>
      Effect.gen(function* () {
        const open = yield* strip({ expanded: true });

        expect(textIn(open)).toContain("Hide 6 children");
        expect(open).toMatch(/<button\b[^>]*aria-expanded="true"/u);
        expect(
          tagsWith(open, "data-family-child").map((tag) =>
            attributeOf(tag, "data-family-child")
          )
        ).toStrictEqual(children);
      })
  );
});

describe("FamilyStrip, once every child landed", () => {
  const landedAll = askStates([
    ...children.map((child, index) =>
      ProjectEvent.cases.AskClosed.make({
        ask: child,
        at,
        landing: sha,
        seq: index + 1,
      })
    ),
    ProjectEvent.cases.Claimed.make({
      ask: finale,
      at,
      claimant: tamsin,
      seq: 10,
    }),
  ]);

  it.effect("says where the delete child stands in its own mark's word", () =>
    Effect.gen(function* () {
      const text = textIn(
        yield* renderAt(
          "/oscabriel/burrow",
          <FamilyStrip
            expanded={false}
            finale={finale}
            parent={parent}
            project={burrow}
            stamps={new Set()}
            states={landedAll}
          />
        )
      );

      expect(text).toContain("6 of 6 landed");
      expect(text).toContain("delete claimed");
      expect(text).not.toContain("open to take");
    })
  );
});

describe("FamilyStrip's listed children", () => {
  it.effect(
    "names a child with no want by its short name, its whole id kept in the title",
    () =>
      Effect.gen(function* () {
        const markup = yield* strip({ expanded: true });

        const links = [
          ...markup.matchAll(
            /<li\b[^>]*data-family-child[^>]*>.*?<a\b(?<attributes>[^>]*)>(?<body>.*?)<\/a>/gsu
          ),
        ].map((match) => [
          attributeOf(match.groups?.attributes ?? "", "title"),
          textIn(match.groups?.body ?? ""),
        ]);

        expect(links).toStrictEqual(
          children.map((child, index) => [child, modules[index]])
        );
      })
  );
});

describe(FamilyTree, () => {
  it.effect(
    "marks the parent waiting while a child it waits on has not landed, as its own page says",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/burrow",
          <FamilyTree
            finale={finale}
            parent={parent}
            project={burrow}
            states={states}
          />
        );

        const head = markup.slice(0, markup.indexOf("</a>"));

        expect(head).toContain(`/oscabriel/burrow/asks/${parent.id}`);
        expect(head).toContain("lucide-hourglass");
      })
  );

  it.effect(
    "draws the parent, its children and the delete child, marking the member being read",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt(
          "/oscabriel/burrow",
          <FamilyTree
            current={id("burrow-kit")}
            finale={finale}
            parent={parent}
            project={burrow}
            states={states}
          />
        );

        const text = textIn(markup);
        const current = tagsWith(markup, "aria-current");

        expect(text.indexOf("drop-legacy-fetch")).toBeLessThan(
          text.indexOf("auth")
        );
        expect(text.indexOf("search")).toBeLessThan(text.indexOf("delete"));
        expect(current).toHaveLength(1);
        expect(attributeOf(current[0] ?? "", "aria-current")).toBe("true");
        expect(current[0]).toContain(
          `/oscabriel/burrow/asks/${id("burrow-kit")}`
        );
      })
  );
});
