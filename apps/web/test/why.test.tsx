/**
 * The file in Why mode, rendered to HTML with `react-dom/server` from a
 * `WhyView` decoded with the protocol's own schema: the server's fallback
 * is the numbered lines with a band above each group of lines one commit
 * brought, ask and answer first and the commit second, each linked; the
 * browser's drawing is Pierre's (`<diffs-container>`), loaded only there,
 * with the same bands as its annotations.
 */
import { describe, expect, it } from "@effect/vitest";
import { Client, Contracts } from "@repo/protocol/contracts";
import { CommitView, FileView, WhyView } from "@repo/protocol/domain/code";
import { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import { LandedSha, ProjectName } from "@repo/protocol/ids";
import { asTester, unanswered } from "@repo/protocol/testing";
import { DateTime, Duration, Effect, Layer, Ref, Schema } from "effect";
import { RpcTest } from "effect/rpc";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LandingDetails } from "../src/features/why/range-summary.tsx";
import { WhyCode } from "../src/features/why/why-code.tsx";
import { WhyLines } from "../src/features/why/why-view.tsx";
import { readWhyPage } from "../src/routes/$owner/$project/why/$rev/$.tsx";

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ");

/** Every `href` in `markup`, in order, entities decoded. */
const hrefsOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*)"/gu)].map((match) =>
    (match.groups?.href ?? "").replaceAll("&amp;", "&")
  );

const datekit = ProjectName.make("oscabriel/datekit");

const AT = "a".repeat(40);

const LANDED = "1".repeat(40);

const IMPORTED = "2".repeat(40);

const ROOT = "3".repeat(40);

const signature = (name: string, at: string) => ({
  at,
  email: `${name.toLowerCase()}@example.com`,
  name,
});

const view = Schema.decodeSync(WhyView)({
  at: AT,
  commits: [
    {
      author: signature("Bram", "2026-10-06T15:00:00.000Z"),
      body: "",
      committer: signature("platform", "2026-10-06T15:00:00.000Z"),
      parents: [IMPORTED],
      sha: LANDED,
      subject: "Answer parse-iso-week",
      trailers: [],
      tree: "4".repeat(40),
    },
    {
      author: signature("Ada", "2026-09-01T09:00:00.000Z"),
      body: "",
      committer: signature("Ada", "2026-09-01T09:00:00.000Z"),
      parents: [ROOT],
      sha: IMPORTED,
      subject: "Add the formatter",
      trailers: [],
      tree: "5".repeat(40),
    },
  ],
  landings: [
    {
      ask: "parse-iso-week",
      assisted: [{ harness: "pi", model: "opus-4", verified: true }],
      author: "bram",
      credits: [
        { handle: "bram", role: "Signed-off-by" },
        { handle: "ines-v", role: "Asked-by" },
      ],
      landedAt: "2026-10-06T15:00:00.000Z",
      parent: IMPORTED,
      project: "datekit",
      sha: LANDED,
      verdict: {
        ask: "parse-iso-week",
        at: "2026-10-06T14:59:00.000Z",
        base: IMPORTED,
        checkVersion: "redThenGreen@0.0.0+abc",
        head: "7".repeat(40),
        heldBack: [],
        lanes: [],
        outcome: Schema.encodeSync(Outcome)(
          Outcome.cases.Landed.make({ sha: LandedSha.make(LANDED) })
        ),
        patchId: "8".repeat(64),
        project: "datekit",
        stage: "checks",
        tree: "4".repeat(40),
        verifier: "platform",
      },
    },
  ],
  path: "src/format.ts",
  ranges: [
    { end: 3, sha: LANDED, start: 1 },
    { end: 4, sha: IMPORTED, start: 4 },
  ],
});

const TEXT =
  "export const iso = 1;\nexport const week = 2;\nexport const day = 3;\nexport const old = 4;\n";

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const page = (
  <WhyLines now={now} project={datekit} rev="main" text={TEXT} view={view} />
);

/** The band of the group marked `data-range` with `value`, up to the next band or line. */
const bandOf = (markup: string, value: string) => {
  const start = markup.indexOf(`data-range="${value}"`);
  const rest = markup.slice(start + 1);

  const ends = [rest.indexOf("data-range="), rest.indexOf(' id="L')].filter(
    (at) => at !== -1
  );

  return start === -1 ? "" : markup.slice(start, start + 1 + Math.min(...ends));
};

describe("the why page's fallback", () => {
  it("names who brought lines 1–3, ask and answer first and the commit second, each linked", () => {
    const band = bandOf(markupOf(page), "1-3");
    const text = textOf(band);

    expect(text).toContain("lines 1–3");
    expect(text).toContain("parse-iso-week");
    expect(text).toContain("answered by bram");
    expect(
      [text.indexOf("parse-iso-week"), text.indexOf("answered by bram")].every(
        (at) => at > -1 && at < text.indexOf(LANDED.slice(0, 7))
      )
    ).toBeTruthy();
    expect(hrefsOf(band)).toStrictEqual(
      expect.arrayContaining([
        "/oscabriel/datekit/asks/parse-iso-week",
        "/oscabriel/datekit/answers/parse-iso-week",
        `/oscabriel/datekit/commit/${LANDED}`,
      ])
    );
  });

  it("counts no credit and colours nothing by age", () => {
    const markup = markupOf(page);

    expect(textOf(markup)).not.toMatch(/\bcredits?\b/u);
    expect(bandOf(markup, "1-3")).not.toMatch(
      /text-(?:landed|waiting|refused|checking)/u
    );
  });

  it("says an imported commit's lines came before adoption", () => {
    const band = bandOf(markupOf(page), "4-4");

    expect(textOf(band)).toContain("line 4");
    expect(textOf(band)).toContain("Add the formatter");
    expect(textOf(band)).toContain("Ada");
    expect(textOf(band)).toContain("before adoption");
    expect(hrefsOf(band)).toContain(`/oscabriel/datekit/commit/${IMPORTED}`);
  });

  it("offers why, one step back, and a proposal about each group's first line", () => {
    const markup = markupOf(page);
    const hrefs = hrefsOf(markup);

    expect(hrefs).toContain(`/oscabriel/datekit/why/${IMPORTED}/src/format.ts`);
    expect(textOf(markup)).toContain("why, one step back");
    expect(textOf(markup)).toContain("Propose an ask about this line");

    const proposal = hrefs
      .filter((href) => href.startsWith("/oscabriel/datekit/proposals/new?"))
      .map((href) =>
        Object.fromEntries(new URL(href, "https://x").searchParams)
      );

    expect(proposal).toStrictEqual([
      { about: "src/format.ts", at: AT, line: "1" },
      { about: "src/format.ts", at: AT, line: "4" },
    ]);
  });

  it("puts each group's band above its first line, among the numbered lines, and leaves the drawing to the browser", () => {
    const markup = markupOf(page);

    expect(markup).toContain('id="L4"');
    expect(markup).toContain('data-why="ranges"');
    expect(markup.indexOf('data-range="4-4"')).toBeLessThan(
      markup.indexOf('id="L4"')
    );
    expect(markup.indexOf('data-range="4-4"')).toBeGreaterThan(
      markup.indexOf('id="L3"')
    );
    expect(markup).not.toContain("<diffs-container");
  });

  it("groups consecutive lines one commit brought into one band", () => {
    const split = Schema.decodeSync(WhyView)({
      ...Schema.encodeSync(WhyView)(view),
      ranges: [
        { end: 2, sha: LANDED, start: 1 },
        { end: 3, sha: LANDED, start: 3 },
        { end: 4, sha: IMPORTED, start: 4 },
      ],
    });

    const markup = markupOf(
      <WhyLines
        now={now}
        project={datekit}
        rev="main"
        text={TEXT}
        view={split}
      />
    );

    expect(
      [...markup.matchAll(/data-range="(?<range>[^"]+)"/gu)].map(
        (match) => match.groups?.range
      )
    ).toStrictEqual(["1-3", "4-4"]);
  });

  it("says why a file without ranges has none", () => {
    const binary = Schema.decodeSync(WhyView)({
      at: AT,
      commits: [],
      landings: [],
      path: "logo.png",
      ranges: [],
    });

    expect(
      textOf(
        markupOf(
          <WhyLines now={now} project={datekit} rev="main" view={binary} />
        )
      )
    ).toContain("binary or too large");
  });

  it("is the same page as the file, in Why mode", () => {
    const toggle =
      /<nav\b[^>]*aria-label="Mode"[\s\S]*?<\/nav>/u.exec(
        markupOf(page)
      )?.[0] ?? "";

    expect(hrefsOf(toggle)).toStrictEqual([
      "/oscabriel/datekit/blob/main/src/format.ts",
      "/oscabriel/datekit/why/main/src/format.ts",
    ]);
    expect(toggle).toMatch(/aria-current="page"[^>]*>Why</u);
  });
});

const OPENED = "6".repeat(40);

/**
 * `src/format.ts` where lines 1–2 came from an ask's opening: a landing
 * with `opened` and no `ask`, so it answers nothing.
 */
const opening = Schema.decodeSync(WhyView)({
  at: AT,
  commits: [
    {
      author: signature("Ines", "2026-10-07T10:00:00.000Z"),
      body: "",
      committer: signature("platform", "2026-10-07T10:00:00.000Z"),
      parents: [LANDED],
      sha: OPENED,
      subject: "Open format-ordinal",
      trailers: [],
      tree: "9".repeat(40),
    },
    ...view.commits.map((commit) => Schema.encodeSync(CommitView)(commit)),
  ],
  landings: [
    ...view.landings.map((landing) => Schema.encodeSync(LandingView)(landing)),
    {
      assisted: [],
      author: "ines-v",
      credits: [{ handle: "ines-v", role: "Signed-off-by" }],
      landedAt: "2026-10-07T10:00:00.000Z",
      opened: "format-ordinal",
      parent: LANDED,
      project: "datekit",
      sha: OPENED,
    },
  ],
  path: "src/format.ts",
  ranges: [
    { end: 1, sha: LANDED, start: 1 },
    { end: 3, sha: OPENED, start: 2 },
    { end: 4, sha: IMPORTED, start: 4 },
  ],
});

const opened = (
  <WhyLines now={now} project={datekit} rev="main" text={TEXT} view={opening} />
);

describe("the why page's band for an ask's opening", () => {
  it('links the ask it opened and reads "opened", with no answer link', () => {
    const band = bandOf(markupOf(opened), "2-3");

    expect(textOf(band)).toContain("opened format-ordinal");
    expect(textOf(band)).toContain("by ines-v");
    expect(hrefsOf(band)).toContain("/oscabriel/datekit/asks/format-ordinal");
    expect(
      hrefsOf(band).filter((href) => href.includes("/answers/"))
    ).toStrictEqual([]);
  });

  it("keeps an answering landing's ask and answer links, and an adopted commit's words", () => {
    const markup = markupOf(opened);

    expect(hrefsOf(bandOf(markup, "1-1"))).toStrictEqual(
      expect.arrayContaining([
        "/oscabriel/datekit/asks/parse-iso-week",
        "/oscabriel/datekit/answers/parse-iso-week",
      ])
    );
    expect(textOf(bandOf(markup, "1-1"))).not.toContain("opened");
    expect(textOf(bandOf(markup, "4-4"))).toContain("before adoption");
  });
});

/** The line dialog's landing, rendered; nothing for no landing. */
const detailsOf = (landing: LandingView | undefined) =>
  landing === undefined
    ? ""
    : markupOf(<LandingDetails landing={landing} project={datekit} />);

describe("a line's landing, in the line dialog", () => {
  it("names the ask an opening opened, linking it, and no answer", () => {
    const markup = detailsOf(
      opening.landings.find(({ sha }) => sha === OPENED)
    );

    expect(textOf(markup)).toContain("Opened ask format-ordinal");
    expect(hrefsOf(markup)).toContain("/oscabriel/datekit/asks/format-ordinal");
    expect(
      hrefsOf(markup).filter((href) => href.includes("/answers/"))
    ).toStrictEqual([]);
  });

  it("names the ask an answering landing answers, with its answer", () => {
    const markup = detailsOf(view.landings[0]);

    expect(textOf(markup)).toContain("Ask parse-iso-week");
    expect(textOf(markup)).not.toContain("Opened ask");
    expect(hrefsOf(markup)).toContain(
      "/oscabriel/datekit/answers/parse-iso-week"
    );
  });
});

describe("the why page's drawing", () => {
  it("draws the file with @pierre/diffs", () => {
    expect(
      markupOf(<WhyCode now={now} project={datekit} text={TEXT} view={view} />)
    ).toContain("<diffs-container");
  });
});

/** What the platform was asked by one page read: each `readFile`'s `at`, and the most calls under way at once. */
interface Asked {
  readonly files: readonly string[];
  readonly peak: number;
  readonly under: number;
}

/**
 * A platform answering `why` with `view` and `readFile` with the file at
 * the commit `main` names (`mainAt`), each after a few milliseconds, every
 * call noted in `asked`.
 */
const whyPlatform = (asked: Ref.Ref<Asked>, mainAt: string) => {
  const during = <A, E>(answer: Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(
      Ref.update(asked, (was) => ({
        ...was,
        peak: Math.max(was.peak, was.under + 1),
        under: was.under + 1,
      })),
      () => Effect.andThen(Effect.sleep(Duration.millis(30)), answer),
      () => Ref.update(asked, (was) => ({ ...was, under: was.under - 1 }))
    );

  return Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("why", () => during(Effect.succeed(view))),
        Contracts.toLayerHandler("log", () => Effect.succeed({ commits: [] })),
        Contracts.toLayerHandler("readFile", (payload) =>
          during(
            Effect.gen(function* () {
              yield* Ref.update(asked, (was) => ({
                ...was,
                files: [...was.files, payload.at ?? "main"],
              }));

              const at =
                payload.at === undefined || payload.at === "main"
                  ? mainAt
                  : payload.at;

              return yield* Schema.decodeEffect(FileView)({
                at,
                binary: false,
                path: "src/format.ts",
                sha: "5".repeat(40),
                size: 6,
                text: `at ${at.slice(0, 4)}\n`,
                truncated: false,
              }).pipe(Effect.orDie);
            })
          )
        )
      ),
      asTester,
    ])
  );
};

const nothingAsked: Asked = { files: [], peak: 0, under: 0 };

const whyAddress = { _splat: "src/format.ts", project: "datekit", rev: "main" };

describe("the why page's read", () => {
  it.live("asks for the why and the file's text at once", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(nothingAsked);

      const read = yield* readWhyPage(whyAddress).pipe(
        // A not-found is TanStack's own error, typed `any`: neither case
        // here reads one.
        Effect.orDie,
        Effect.provide(whyPlatform(asked, AT))
      );

      expect(read.text).toBe("at aaaa\n");
      expect(yield* Ref.get(asked)).toStrictEqual({
        files: ["main"],
        peak: 2,
        under: 0,
      });
    })
  );

  it.live(
    "reads the file again at the why's commit when main moved between the two reads",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const read = yield* readWhyPage(whyAddress).pipe(
          // A not-found is TanStack's own error, typed `any`: neither case
          // here reads one.
          Effect.orDie,
          Effect.provide(whyPlatform(asked, "b".repeat(40)))
        );

        expect(read.text).toBe("at aaaa\n");
        expect((yield* Ref.get(asked)).files).toStrictEqual(["main", AT]);
      })
  );
});
