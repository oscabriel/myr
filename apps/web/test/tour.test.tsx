import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { explain } from "@repo/protocol/render";
import { Effect } from "effect";

import { commands } from "../src/features/agents/catalog.ts";
import {
  EXAMPLE,
  EXAMPLE_REFUSALS,
} from "../src/features/landing/transcript.ts";
import { readTourLive } from "../src/features/tour/read.ts";
import { STEPS, TourView } from "../src/features/tour/tour-page.tsx";
import { EXAMPLE_NOTE, TOUR_LEDE } from "../src/features/tour/words.ts";
import { Route, tourHead } from "../src/routes/tour.tsx";
import { allInOrder, textIn } from "./markup.ts";
import { platformWith, unreachablePlatform } from "./platform.ts";
import { renderAt } from "./render.tsx";

const PLATFORM = "https://platform.example.workers.dev";

const BOTH = { asks: true, landings: true };

const NEITHER = { asks: false, landings: false };

const pageWith = (live: { asks: boolean; landings: boolean }) =>
  renderAt("/tour", <TourView live={live} platformUrl={PLATFORM} />);

const hrefsOf = (markup: string) =>
  [...markup.matchAll(/<a\b[^>]*href="(?<href>[^"]+)"/gu)].map(
    (found) => found.groups?.href
  );

/** Each step's markup, by its id. */
const stepsOf = (markup: string) =>
  new Map(
    [
      ...markup.matchAll(
        /<li\b[^>]*data-step="(?<id>[^"]+)"[\s\S]*?(?=<li\b[^>]*data-step=|<\/ol>)/gu
      ),
    ].map(([step, id]) => [id, step])
  );

/** A CLI command's words: its path and flags, as `commandDocs` lists them. */
const partsOf = (command: string) => {
  const [, ...words] = command.split(/\s+/u);

  return {
    flags: words
      .filter((word) => word.startsWith("--"))
      .map((word) => word.split("=")[0] ?? word),
    name: words[0] ?? "",
  };
};

describe(TourView, () => {
  it.effect("walks six steps, each with its numbered command, in order", () =>
    Effect.gen(function* () {
      const markup = yield* pageWith(NEITHER);
      const steps = stepsOf(markup);

      expect([...steps.keys()]).toStrictEqual([
        "find",
        "read",
        "claim",
        "refused",
        "land",
        "credit",
      ]);
      expect(
        allInOrder(
          textIn(markup),
          STEPS.map(({ command }) => command)
        )
      ).toBeTruthy();
      // One command box per step; the keys number them once the page has a registry, which the server has not.
      expect(markup.match(/<code class="[^"]*select-all"/gu)).toHaveLength(6);
    })
  );

  it("gives each CLI command only flags the command list says it takes", () => {
    const wrong = STEPS.flatMap(({ command }) => {
      if (!command.startsWith(`${Brand.cli} `)) {
        return [];
      }

      const { flags, name } = partsOf(command);
      const doc = commands.find(({ path }) => path.join(" ") === name);

      if (doc === undefined) {
        return [`${command}: no such command`];
      }

      return flags
        .filter((flag) => !doc.flags.includes(flag))
        .map((flag) => `${command}: ${name} takes no ${flag}`);
    });

    expect(wrong).toStrictEqual([]);
  });

  it.effect(
    "prints the refusal as the one renderer gives it, through git, with its next command and whether retrying helps",
    () =>
      Effect.gen(function* () {
        const refused = textIn(
          stepsOf(yield* pageWith(NEITHER)).get("refused") ?? ""
        );

        for (const line of explain(EXAMPLE_REFUSALS)) {
          expect(refused).toContain(`remote: ${line}`);
        }

        expect(refused).toContain(`remote:   next: ${Brand.cli} check`);
        expect(refused).toContain("remote:   retryable: no");
        expect(refused).toContain(
          ` ! [remote rejected] HEAD -> main (OutOfScope)`
        );
      })
  );

  it.effect(
    "draws the first screens with the real components over the example: the ask's row, its brief and territory, and the claim's receipt",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(NEITHER);
        const steps = stepsOf(markup);
        const text = (id: string) => textIn(steps.get(id) ?? "");

        expect(steps.get("find")).toContain(`data-ask="${EXAMPLE.ask}"`);
        expect(text("find")).toContain(
          "parseISO accepts ISO week dates such as 2026-W41-3."
        );
        expect(
          ["Current behaviour", "Territory and check"].filter(
            (heading) => !text("read").includes(heading)
          )
        ).toStrictEqual([]);
        expect(text("claim")).toContain(
          `You hold the claim on ${EXAMPLE.ask} in ${EXAMPLE.project} until`
        );
        expect(text("claim")).toContain(
          `${PLATFORM}/datekit--parse-iso--alice.git`
        );
      })
  );

  it.effect(
    "draws the landing as the push's receipt over the seven stages, then the credit trailers with the agent set apart, on an example it names as fictional",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageWith(NEITHER);
        const steps = stepsOf(markup);
        const text = (id: string) => textIn(steps.get(id) ?? "");

        expect(text("land")).toContain("remote: checking parse-iso at 1a2b3c4");
        expect([
          ...(steps.get("land") ?? "").matchAll(/data-stage="[^"]+"/gu),
        ]).toHaveLength(7);
        expect(
          allInOrder(text("credit"), [
            `Asked-by: ${EXAMPLE.asker}`,
            `Signed-off-by: ${EXAMPLE.claimant}`,
            "Agents used, disclosed and not credit",
            "Assisted-by: claude-code:haiku (self-reported)",
          ])
        ).toBeTruthy();
        expect(textIn(markup)).toContain(EXAMPLE_NOTE);
      })
  );

  it.effect(
    "points at the live asks and landings only when the platform has any",
    () =>
      Effect.gen(function* () {
        const both = yield* pageWith(BOTH);
        const neither = yield* pageWith(NEITHER);

        expect(
          hrefsOf(both).filter((href) => href === "/#landing-now")
        ).toHaveLength(1);
        expect(both.match(/data-live=""/gu)).toHaveLength(2);
        expect(neither).not.toContain('data-live=""');
        expect(hrefsOf(neither)).toContain("/asks");
        expect(hrefsOf(neither)).toContain("/install");
      })
  );

  it("is drawn in the site shell, and unfurls with its own sentence", () => {
    expect(Route.options.staticData?.shell).toBe("site");
    expect(tourHead().meta).toContainEqual({
      content: TOUR_LEDE,
      name: "description",
    });
  });
});

describe("what the tour can point at, read on the server", () => {
  it.effect("is nothing while the platform lists no ask and no landing", () =>
    Effect.gen(function* () {
      const live = yield* readTourLive.pipe(
        Effect.provide(
          platformWith(
            Contracts.toLayerHandler("frontPage", () =>
              Effect.succeed({ entries: [] })
            ),
            Contracts.toLayerHandler("recentLandings", () =>
              Effect.succeed({ landings: [] })
            )
          )
        )
      );

      expect(live).toStrictEqual(NEITHER);
    })
  );

  it.effect(
    "is nothing, and never fails, when the platform did not answer",
    () =>
      Effect.gen(function* () {
        const live = yield* readTourLive.pipe(
          Effect.provide(unreachablePlatform)
        );

        expect(live).toStrictEqual(NEITHER);
      })
  );
});
