import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { RefsView as Refs } from "@repo/protocol/domain/code";
import { defaultParseSearch } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RefChoices } from "../src/features/code/ref-switcher.tsx";
import { packageParamOf } from "../src/features/code/refs-param.ts";
import { RefsView, TAGS_PAGE } from "../src/features/code/refs-view.tsx";
import { plainText } from "./ask-fixtures.ts";
import { elementWith, factsOf, mainOf } from "./records.ts";
import { renderAt } from "./render.tsx";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

const textOf = (element: ReactElement) => plainText(markupOf(element));

const hrefsOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*)"/gu)].map((match) =>
    (match.groups?.href ?? "").replaceAll("&amp;", "&")
  );

const slice = (markup: string, marker: string, value: string) => {
  const start = markup.indexOf(`${marker}="${value}"`);
  const next = markup.indexOf(`${marker}="`, start + 1);

  return start === -1
    ? ""
    : markup.slice(start, next === -1 ? undefined : next);
};

const platformUrl = "https://platform-test.example.workers.dev";

const LANDED = "1".repeat(40);

const IMPORTED = "2".repeat(40);

const OLDER = "3".repeat(40);

const TAG_SEGMENT = "%40datekit%2Fcore%401.0.0";

const pickNothing = () => {};

describe(RefsView, () => {
  const refs = Schema.decodeSync(Refs)({
    forks: [
      {
        ask: "parse-iso",
        handle: "ines-v",
        kind: "claim",
        repo: "datekit--parse-iso--ines-v",
        state: "live",
      },
      { handle: "bram", kind: "working", repo: "datekit--me--bram" },
    ],
    landed: LANDED,
    project: "datekit",
    tags: [
      { name: "v1.1.0", sha: IMPORTED },
      { name: "v1.0.0", sha: OLDER },
    ],
  });

  const page = <RefsView platformUrl={platformUrl} refs={refs} />;

  it("is titled Refs", () => {
    expect(markupOf(page)).toMatch(/<h1\b[^>]*>Refs<\/h1>/u);
  });

  it("shows main as a row that moves only by a landing, at its landed commit, linked", () => {
    const main = elementWith(mainOf(markupOf(page)), 'data-ref="main"');

    expect(plainText(main)).toContain("moves only by a landing");
    expect(main).toContain(LANDED.slice(0, 7));
    expect(main).toContain(`title="${LANDED}"`);
    expect(hrefsOf(main)).toContain(`/oscabriel/datekit/commit/${LANDED}`);
  });

  it("offers main's files from its row", () => {
    const main = elementWith(mainOf(markupOf(page)), 'data-ref="main"');

    expect(hrefsOf(main)).toContain("/oscabriel/datekit/tree/main");
    expect(plainText(main)).toContain("Browse files");
  });

  it("says plainly when nothing has landed on main", () => {
    const empty = Schema.decodeSync(Refs)({
      forks: [],
      project: "datekit",
      tags: [],
    });

    expect(
      textOf(<RefsView platformUrl={platformUrl} refs={empty} />)
    ).toContain("Nothing has landed on main yet.");
  });

  it("lists the tags newest first, each linking its tree first and its commit", () => {
    const markup = mainOf(markupOf(page));
    const newest = slice(markup, "data-tag", "v1.1.0");

    expect(markup.indexOf('data-tag="v1.1.0"')).toBeGreaterThan(-1);
    expect(markup.indexOf('data-tag="v1.1.0"')).toBeLessThan(
      markup.indexOf('data-tag="v1.0.0"')
    );
    expect(hrefsOf(newest).slice(0, 2)).toStrictEqual([
      "/oscabriel/datekit/tree/v1.1.0",
      `/oscabriel/datekit/commit/${IMPORTED}`,
    ]);
  });

  it("draws a claim fork as one line: its name in mono, its answer, its claimant and the claim's state in a word", () => {
    const fork = elementWith(
      mainOf(markupOf(page)),
      'data-fork="datekit--parse-iso--ines-v"'
    );

    expect(fork).toContain('data-state="live"');
    expect(fork).toMatch(
      /<p\b[^>]*font-mono[^>]*><a\b[^>]*>datekit--parse-iso--ines-v</u
    );
    expect(hrefsOf(fork)).toStrictEqual([
      "/oscabriel/datekit/answers/parse-iso",
      "/people/ines-v",
    ]);
    expect(plainText(fork)).toContain("Claimed");
    // One line: the row holds one line of text, not two.
    expect(fork.match(/<p\b/gu)).toHaveLength(1);
  });

  it("names a working fork's person, apart from the claims", () => {
    const fork = elementWith(
      mainOf(markupOf(page)),
      'data-fork="datekit--me--bram"'
    );

    expect(plainText(fork)).toContain("datekit--me--bram");
    expect(plainText(fork)).toContain("Working fork of");
    expect(hrefsOf(fork)).toContain("/people/bram");
  });

  it("puts the clone command and what a claim fork is in its facts", () => {
    const facts = factsOf(markupOf(page));

    expect(plainText(facts)).toContain(
      `git clone ${platformUrl}/oscabriel/datekit.git`
    );
    // The command is the text of the one code element a tap selects whole.
    expect(
      plainText(
        /<code\b[^>]*select-all[^>]*>.*?<\/code>/u.exec(facts)?.[0] ?? ""
      )
    ).toMatch(/^ ?git clone /u);
    expect(plainText(facts)).toContain("claim fork");
  });

  it("never names the platform's own refs, and says tags, not releases", () => {
    const text = textOf(page);

    expect(text).not.toContain(Brand.refsPrefix);
    expect(text).not.toContain("refs/notes");
    expect(text.toLowerCase()).not.toContain("release");
  });

  it("lists no packages when the tags version none or one", () => {
    const one = Schema.decodeSync(Refs)({
      forks: [],
      project: "datekit",
      tags: [
        { name: "v1.1.0", sha: IMPORTED },
        { name: "@datekit/core@2.0.0", sha: LANDED },
        { name: "@datekit/core@1.0.0", sha: OLDER },
      ],
    });

    const view = <RefsView platformUrl={platformUrl} refs={one} />;

    expect(markupOf(page)).not.toContain("data-package=");
    expect(markupOf(view)).not.toContain("data-package=");
    expect(textOf(view)).not.toContain("Packages");
  });

  it.effect("sits under the project's crumbs: datekit, then Refs", () =>
    Effect.gen(function* () {
      const markup = yield* renderAt("/oscabriel/datekit/refs", page);
      const crumbs = elementWith(markup, 'aria-label="Breadcrumb"');

      expect(crumbs).toMatch(
        /<a\b[^>]*href="\/oscabriel\/datekit"[^>]*>oscabriel\/datekit<\/a>/u
      );
      expect(plainText(crumbs)).toContain("Refs");
    })
  );
});

const viewOf = (refs: Refs, only?: string, from?: number) => (
  <RefsView from={from} package={only} platformUrl={platformUrl} refs={refs} />
);

describe("a monorepo's refs page", () => {
  const monorepo = Schema.decodeSync(Refs)({
    forks: [],
    landed: LANDED,
    project: "datekit",
    tags: [
      { name: "v1.1.0", sha: IMPORTED },
      { name: "@datekit/core@2.0.0", sha: LANDED },
      { name: "@datekit/core@1.0.0", sha: OLDER },
      { name: "fmt@0.1.0", sha: OLDER },
    ],
  });

  const CORE = "/oscabriel/datekit/refs?package=%40datekit%2Fcore";

  it("lists each package above the tags, with its newest tag, linked to its tree, and its count", () => {
    const markup = mainOf(markupOf(viewOf(monorepo)));
    const core = slice(markup, "data-package", "@datekit/core");
    const fmt = slice(markup, "data-package", "fmt");

    expect(textOf(viewOf(monorepo))).toContain("Packages");
    expect(hrefsOf(core)).toStrictEqual([
      CORE,
      `/oscabriel/datekit/tree/${TAG_SEGMENT.replace("1.0.0", "2.0.0")}`,
    ]);
    expect(plainText(core)).toContain("2 tags");
    // The last package's slice runs on to the page's end: its first two links.
    expect(hrefsOf(fmt).slice(0, 2)).toStrictEqual([
      "/oscabriel/datekit/refs?package=fmt",
      "/oscabriel/datekit/tree/fmt%400.1.0",
    ]);
    expect(fmt).toContain("1 tag<");
  });

  it("puts the packages above the tags", () => {
    const markup = markupOf(viewOf(monorepo));

    expect(markup.indexOf('data-package="@datekit/core"')).toBeGreaterThan(-1);
    expect(markup.indexOf('data-package="@datekit/core"')).toBeLessThan(
      markup.indexOf('data-tag="v1.1.0"')
    );
  });

  it("lists only one package's tags, newest first, with a way back to all", () => {
    const element = viewOf(monorepo, "@datekit/core");
    const markup = markupOf(element);

    expect(
      [...markup.matchAll(/data-tag="(?<tag>[^"]*)"/gu)].map(
        (match) => match.groups?.tag
      )
    ).toStrictEqual(["@datekit/core@2.0.0", "@datekit/core@1.0.0"]);
    expect(markup).not.toContain("data-package=");
    expect(hrefsOf(markup)).toContain("/oscabriel/datekit/refs");
    expect(textOf(element)).toContain("All tags");
  });

  it("pages one package's tags, keeping the package in the address", () => {
    const many = Schema.decodeSync(Refs)({
      forks: [],
      project: "datekit",
      tags: [
        ...Array.from({ length: TAGS_PAGE + 1 }, (_, at) => ({
          name: `@datekit/core@1.0.${TAGS_PAGE - at}`,
          sha: OLDER,
        })),
        { name: "fmt@0.1.0", sha: OLDER },
      ],
    });

    expect(hrefsOf(markupOf(viewOf(many, "@datekit/core")))).toContain(
      `${CORE}&from=${TAGS_PAGE}`
    );
    expect(
      hrefsOf(markupOf(viewOf(many, "@datekit/core", TAGS_PAGE)))
    ).toContain(CORE);
  });

  it("says plainly that a package it does not know has no tags", () => {
    const element = viewOf(monorepo, "@datekit/none");

    expect(markupOf(element)).not.toContain("data-tag=");
    expect(textOf(element)).toContain("No tags for @datekit/none.");
    expect(hrefsOf(markupOf(element))).toContain("/oscabriel/datekit/refs");
  });

  it("links each package so the router reads its name back, even one that reads as a number", () => {
    const odd = Schema.decodeSync(Refs)({
      forks: [],
      project: "datekit",
      tags: [
        { name: "2048@1.0.0", sha: OLDER },
        { name: "true@1.0.0", sha: OLDER },
        { name: "@datekit/core@1.0.0", sha: OLDER },
      ],
    });

    const read = hrefsOf(markupOf(viewOf(odd)))
      .filter((href) => href.includes("package="))
      .map((href) => {
        // What the router hands the route's `validateSearch`.
        const search = defaultParseSearch(new URL(href, "https://web").search);

        return packageParamOf("package" in search ? search.package : undefined);
      });

    expect(read).toStrictEqual([
      Option.some("2048"),
      Option.some("true"),
      Option.some("@datekit/core"),
    ]);
  });

  it("reads a package from the address only when it names one", () => {
    expect(packageParamOf("@datekit/core")).toStrictEqual(
      Option.some("@datekit/core")
    );
    expect(
      [undefined, "", 3, "x".repeat(256)].map((value) => packageParamOf(value))
    ).toStrictEqual([
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
  });
});

describe(RefChoices, () => {
  const refs = Schema.decodeSync(Refs)({
    forks: [
      {
        ask: "parse-iso",
        handle: "ines-v",
        kind: "claim",
        repo: "datekit--parse-iso--ines-v",
        state: "warned",
      },
      { handle: "bram", kind: "working", repo: "datekit--me--bram" },
    ],
    landed: LANDED,
    project: "oscabriel/datekit",
    tags: [
      { name: "v1.1.0", sha: IMPORTED },
      { name: "v1.0.0", sha: OLDER },
    ],
  });

  const choices = (filter = "") =>
    markupOf(
      <RefChoices
        filter={filter}
        hrefAt={(rev) => `/oscabriel/datekit/tree/${rev}`}
        onPick={pickNothing}
        refs={refs}
        rev="main"
      />
    );

  /** Ines's fork entry, as the list draws it while `rev` is read. */
  const forkAt = (rev: string) =>
    elementWith(
      markupOf(
        <RefChoices
          hrefAt={(to) => `/oscabriel/datekit/tree/${to}`}
          onPick={pickNothing}
          refs={refs}
          rev={rev}
        />
      ),
      'data-fork="ines-v/parse-iso"'
    );

  it("lists main as current, then the tags, then the answers in forks", () => {
    const markup = choices();

    expect(
      [
        ...markup.matchAll(/data-(?:ref-choice|tag|fork)="(?<name>[^"]*)"/gu),
      ].map(({ groups }) => groups?.name)
    ).toStrictEqual(["main", "v1.1.0", "v1.0.0", "ines-v/parse-iso"]);
    expect(elementWith(markup, 'data-ref-choice="main"')).toContain(
      'aria-current="true"'
    );
  });

  it("names each answer's ask, claimant and claim state, and opens the fork at its address", () => {
    const fork = elementWith(choices(), 'data-fork="ines-v/parse-iso"');

    expect(hrefsOf(fork)).toStrictEqual([
      "/oscabriel/datekit/tree/@ines-v/parse-iso",
    ]);
    expect(plainText(fork)).toContain("parse-iso");
    expect(plainText(fork)).toContain("ines-v · Warned, no push lately");
  });

  it("marks the fork being read as current, at its main or at one of its commits", () => {
    expect(
      [
        "@ines-v/parse-iso",
        `@ines-v/parse-iso:${LANDED}`,
        "main",
        "@bram/parse-iso",
      ].map((rev) => forkAt(rev).includes('aria-current="true"'))
    ).toStrictEqual([true, true, false, false]);
  });

  it("lists no working fork and names no fork's repo", () => {
    const markup = choices();

    expect(markup).not.toContain("datekit--me--bram");
    expect(markup).not.toContain("datekit--parse-iso--ines-v");
  });

  it("finds a fork by its claimant or its ask, and a tag by its name", () => {
    expect(choices("ines").match(/data-(?:tag|fork)="[^"]*"/gu)).toStrictEqual([
      'data-fork="ines-v/parse-iso"',
    ]);
    expect(choices("v1.0").match(/data-(?:tag|fork)="[^"]*"/gu)).toStrictEqual([
      'data-tag="v1.0.0"',
    ]);
  });
});
