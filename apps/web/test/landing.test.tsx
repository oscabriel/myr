import { describe, expect, it } from "@effect/vitest";
import { installCommand } from "@repo/agent-kit/install";
import { Brand } from "@repo/brand";
import { authorLine } from "@repo/git/trailers";
import { Contracts } from "@repo/protocol/contracts";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Handle } from "@repo/protocol/ids";
import { DateTime, Effect, Schema } from "effect";

import glossary from "../../../GLOSSARY.md?raw";
import { LandingNow } from "../src/features/landing/landing-now.ts";
import { LandingView } from "../src/features/landing/landing-page.tsx";
import { readLandingNow } from "../src/features/landing/read.ts";
import { LEDE } from "../src/features/landing/words.ts";
import { landingHead } from "../src/routes/index.tsx";
import { allInOrder, textIn } from "./markup.ts";
import { platformWith, unreachablePlatform } from "./platform.ts";
import { renderAt } from "./render.tsx";

const PLATFORM = "https://platform.example.workers.dev";

const WEB = "https://web.example.workers.dev";

const NOW = DateTime.makeUnsafe("2026-10-12T12:00:00Z");

const landed = LandingNow.cases.Listed.make({
  now: NOW,
  projects: Schema.decodeSync(Schema.Array(ProjectListing))([
    {
      landedAt: "2026-10-12T11:58:00Z",
      openAsks: 2,
      posture: "openWithSealedEvidence",
      project: "oscabriel/datekit",
    },
    {
      landedAt: "2026-10-12T09:00:00Z",
      openAsks: 6,
      posture: "open",
      project: "oscabriel/burrow",
    },
  ]),
});

const pageWith = (landings: LandingNow) =>
  renderAt(
    "/",
    <LandingView landings={landings} platformUrl={PLATFORM} webUrl={WEB} />
  );

/** A credit line as the platform forms it, so the transcript cannot drift from it. */
const credit = (handle: string) => {
  const { email, name } = authorLine(Handle.make(handle));

  return `${name} <${email}>`;
};

const mainOf = (markup: string) => markup.slice(markup.indexOf("<main"));

const hrefsOf = (markup: string) =>
  [...markup.matchAll(/<a\b[^>]*href="(?<href>[^"]+)"/gu)].map(
    (found) => found.groups?.href
  );

/** A "landing now" row, by its project. */
const rowOf = (markup: string, project: string) =>
  new RegExp(`<li\\b[^>]*data-project="${project}"[\\s\\S]*?</li>`, "u").exec(
    markup
  )?.[0] ?? "";

/** Eight that have landed, out of order, and two that never have. */
const EIGHT_LANDED = Schema.decodeSync(Schema.Array(ProjectListing))([
  {
    landedAt: "2026-10-10T08:00:00Z",
    openAsks: 1,
    posture: "open",
    project: "oscabriel/alpha",
  },
  {
    landedAt: "2026-10-12T11:00:00Z",
    openAsks: 5,
    posture: "open",
    project: "oscabriel/datekit",
  },
  { openAsks: 0, posture: "open", project: "oscabriel/zeta" },
  {
    landedAt: "2026-10-11T09:00:00Z",
    openAsks: 9,
    posture: "open",
    project: "oscabriel/burrow",
  },
  {
    landedAt: "2026-10-12T11:30:00Z",
    openAsks: 3,
    posture: "open",
    project: "oscabriel/kite",
  },
  {
    landedAt: "2026-10-11T20:00:00Z",
    openAsks: 5,
    posture: "open",
    project: "github.com/pallets/click",
  },
  { openAsks: 0, posture: "open", project: "oscabriel/yarrow" },
  {
    landedAt: "2026-10-01T00:00:00Z",
    openAsks: 2,
    posture: "open",
    project: "github.com/sindresorhus/ky",
  },
  {
    landedAt: "2026-10-09T00:00:00Z",
    openAsks: 3,
    posture: "open",
    project: "oscabriel/hearth",
  },
  {
    landedAt: "2026-10-12T10:00:00Z",
    openAsks: 7,
    posture: "open",
    project: "oscabriel/ember",
  },
]);

/** One of the hero's two panels, by its flow. */
const panelOf = (markup: string, flow: string) =>
  new RegExp(
    `<section\\b[^>]*data-flow="${flow}"[\\s\\S]*?</section>`,
    "u"
  ).exec(markup)?.[0] ?? "";

const stepsIn = (panel: string) =>
  [...panel.matchAll(/data-step="(?<step>[^"]+)"/gu)].map(
    (found) => found.groups?.step
  );

/** Code hosts and forges by name: the comparison describes the usual flow by mechanism alone. */
const PRODUCTS =
  /github|gitlab|bitbucket|gerrit|gitea|forgejo|codeberg|sourcehut/iu;

/** A word's definition in GLOSSARY.md, the line under its bold head. */
const defined = (word: string) =>
  new RegExp(`^\\*\\*${word}\\*\\*:\\n(?<means>.+)$`, "mu").exec(glossary)
    ?.groups?.means;

describe(LandingView, () => {
  it.effect(
    "has one primary action, to the open asks, beside the install command",
    () =>
      Effect.gen(function* () {
        const main = mainOf(yield* pageWith(landed));

        expect(hrefsOf(main)[0]).toBe("/asks");
        expect(
          [...main.matchAll(/data-action="(?<action>[^"]+)"/gu)].map(
            (found) => found.groups?.action
          )
        ).toStrictEqual(["asks"]);
        expect(textIn(main)).toContain(installCommand(WEB));
      })
  );

  it.effect("draws the gate's seven stages in order", () =>
    Effect.gen(function* () {
      const main = mainOf(yield* pageWith(landed));
      const gate = main.slice(main.indexOf('aria-labelledby="gate"'));

      expect(
        [...gate.matchAll(/data-stage="(?<stage>[^"]+)"/gu)].map(
          (found) => found.groups?.stage
        )
      ).toStrictEqual([
        "parse",
        "shape",
        "merge",
        "cheap",
        "checks",
        "heldBack",
        "human",
      ]);
      expect(
        allInOrder(textIn(gate), [
          "Parse",
          "Shape",
          "Merge",
          "Cheap",
          "Checks",
          "Held-back",
          "Maintainer",
        ])
      ).toBeTruthy();
    })
  );

  it.effect("names the four words as GLOSSARY.md defines them", () =>
    Effect.gen(function* () {
      const markup = yield* pageWith(landed);
      const words = ["Ask", "Answer", "Check", "Refusal"];

      expect(
        [...markup.matchAll(/data-noun="(?<noun>[^"]+)"/gu)].map(
          (found) => found.groups?.noun
        )
      ).toStrictEqual(["ask", "answer", "check", "refusal"]);
      expect(
        words.filter(
          (word) => !textIn(markup).includes(defined(word) ?? `(${word})`)
        )
      ).toStrictEqual([]);
    })
  );

  it.effect("links to every way in and to the projects", () =>
    Effect.gen(function* () {
      const hrefs = hrefsOf(mainOf(yield* pageWith(landed)));

      expect(hrefs).toContain("/install");
      expect(hrefs).toContain("/explore");
    })
  );

  it.effect(
    "shows the refusal as git prints it, with the platform's own lines and the rejected ref",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(landed);

        const refused = textIn(
          markup
            .slice(markup.indexOf('data-output="refused"'))
            .split("</figure>")[0] ?? ""
        );

        expect(refused).toContain(
          "remote: OutOfScope: changes paths outside the ask's territory: README.md"
        );
        expect(refused).toContain(`remote:   next: ${Brand.cli} check`);
        expect(refused).toContain(
          " ! [remote rejected] HEAD -> main (OutOfScope)"
        );
        expect(refused).toContain(
          `To ${PLATFORM}/datekit--parse-iso--alice.git`
        );
      })
  );

  it.effect(
    "shows a landed answer as the push's receipt, then the landing commit's credit",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(landed);

        const output = textIn(
          markup
            .slice(markup.indexOf('data-output="landed"'))
            .split("</figure>")[0] ?? ""
        );

        expect(output).toContain(
          `remote: checking parse-iso at 1a2b3c4; follow with ${Brand.cli} status`
        );
        expect(output).toContain(`Asked-by: ${credit("dora")}`);
        expect(output).toContain(`Signed-off-by: ${credit("alice")}`);
      })
  );

  it.effect(
    "compares the usual flow, by its mechanism under an X, with an ask landing through the gate under a check",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(landed);
        const usual = panelOf(markup, "usual");
        const gate = panelOf(markup, "gate");

        expect(stepsIn(usual)).toStrictEqual([
          "issue",
          "branch",
          "pull request",
          "review comments",
          "merge button",
          "main",
        ]);
        expect(stepsIn(gate)).toStrictEqual([
          "ask",
          "claim",
          "answer",
          "gate",
          "main",
        ]);
        expect(
          [usual, gate].map((panel) => /lucide-(?:x|check)\b/u.exec(panel)?.[0])
        ).toStrictEqual(["lucide-x", "lucide-check"]);
        expect(textIn(usual + gate)).not.toMatch(PRODUCTS);
      })
  );

  it.effect(
    "uses no banned word outside the usual flow's panel, and no shadowed, gradient or rounder surface than a card's",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(landed);
        const usual = panelOf(markup, "usual");
        const text = textIn(markup.replace(usual, "")).toLowerCase();

        // DESIGN.md's list, and the glossary's words to avoid. "Merge" is banned for a landing; Inbox and Explore are page names now.
        expect(
          [
            "review",
            "approve",
            "issue",
            "pull request",
            "lease",
            "reputation",
            "queue",
            "dashboard",
            "trending",
          ].filter((word) => text.includes(word))
        ).toStrictEqual([]);
        expect(text).not.toMatch(/\bprs?\b/u);
        expect(
          [...markup.matchAll(/class="(?<names>[^"]*)"/gu)].flatMap((found) =>
            (found.groups?.names ?? "")
              .split(" ")
              // `rounded-none` takes rounding away; `rounded-md` is the card's 2 px.
              .filter((name) =>
                /^(?:rounded-(?!none$|md$)|shadow|bg-gradient)/u.test(name)
              )
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "draws the comparison and the gate as inline SVG, and moves only where motion is welcome",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(landed);
        const main = mainOf(markup);

        expect(
          ["usual", "gate"].map((flow) =>
            panelOf(markup, flow).includes("<svg")
          )
        ).toStrictEqual([true, true]);
        expect(main.slice(main.indexOf('aria-labelledby="gate"'))).toContain(
          "<svg"
        );
        expect(
          [...main.matchAll(/class="(?<names>[^"]*)"/gu)].flatMap((found) =>
            (found.groups?.names ?? "")
              .split(" ")
              // A transition is the shared controls', which styles.css makes instant under reduced motion.
              .filter((name) => /(?:^|:)animate-/u.test(name))
              .filter((name) => !name.startsWith("motion-safe:"))
          )
        ).toStrictEqual([]);
      })
  );

  it.effect(
    "lists landings as they happen, the latest first, each project linking its home with its posture",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(landed);
        const datekit = rowOf(markup, "oscabriel/datekit");

        expect(
          [
            ...markup.matchAll(/<li\b[^>]*data-project="(?<project>[^"]+)"/gu),
          ].map((found) => found.groups?.project)
        ).toStrictEqual(["oscabriel/datekit", "oscabriel/burrow"]);
        expect(hrefsOf(datekit)).toContain("/oscabriel/datekit");
        // The posture badge, with its mark, not the word alone.
        expect(datekit).toMatch(
          /<\/svg><span\b[^>]*><span data-posture="openWithSealedEvidence"/u
        );
        expect(textIn(datekit)).toContain("Landed 2 min ago");
        expect(textIn(rowOf(markup, "oscabriel/burrow"))).toContain(
          "6 open asks"
        );
      })
  );

  it.effect(
    "says so when nothing has landed, or when the platform did not answer, and still leads to the asks",
    () =>
      Effect.gen(function* () {
        const none = yield* pageWith(
          LandingNow.cases.Listed.make({ now: NOW, projects: [] })
        );

        const unreachable = yield* pageWith(
          LandingNow.cases.Unreachable.make({})
        );

        expect(textIn(none)).toContain(
          "Nothing has landed on a public project yet."
        );
        expect(textIn(unreachable)).toContain("The platform did not answer.");
        expect(hrefsOf(mainOf(unreachable))[0]).toBe("/asks");
      })
  );

  it("unfurls with its own sentence, the README's lede", () => {
    expect(landingHead().meta).toContainEqual({
      content: LEDE,
      name: "description",
    });
  });
});

const listing = (projects: readonly ProjectListing[]) =>
  platformWith(
    Contracts.toLayerHandler("listProjects", () => Effect.succeed({ projects }))
  );

describe("the landing's landings, read on the server", () => {
  it.effect(
    "names the projects that have landed, the latest landing first, at most six",
    () =>
      Effect.gen(function* () {
        const read = yield* readLandingNow.pipe(
          Effect.provide(listing(EIGHT_LANDED))
        );

        expect(
          LandingNow.match(read, {
            Listed: ({ projects }) => projects.map(({ project }) => project),
            Unreachable: () => [],
          })
        ).toStrictEqual([
          "oscabriel/kite",
          "oscabriel/datekit",
          "oscabriel/ember",
          "github.com/pallets/click",
          "oscabriel/burrow",
          "oscabriel/alpha",
        ]);
      })
  );

  it.effect("says so, and never fails, when the platform did not answer", () =>
    Effect.gen(function* () {
      const read = yield* readLandingNow.pipe(
        Effect.provide(unreachablePlatform)
      );

      expect(read._tag).toBe("Unreachable");
    })
  );
});
