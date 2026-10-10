/**
 * What the browser checks share: axe's serious and critical violations on a
 * page, and how far a page scrolls sideways. `a11y.e2e.ts` runs them over
 * every page; `landing.e2e.ts` adds the landing at 360 px.
 */
import type { Page } from "@playwright/test";
import { Effect, Schema } from "effect";

/** axe-core, from cdnjs, at the version this check was written against. */
const AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

/** What axe's `run` resolves to, as much of it as this check reads. */
const AxeRun = Schema.Struct({
  violations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      impact: Schema.NullOr(Schema.String),
      nodes: Schema.Array(
        Schema.Struct({ target: Schema.Array(Schema.Unknown) })
      ),
    })
  ),
});

const decodeAxeRun = Schema.decodeUnknownEffect(AxeRun);

/** axe's serious and critical violations on the page, as `rule (n): targets`. */
export const axeOn = (page: Page) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => page.addScriptTag({ url: AXE }));

    // axe's results come from the page: decoded here, as any outside input.
    const raw: unknown = yield* Effect.promise(() =>
      page.evaluate("axe.run()")
    );

    const result = yield* Effect.orDie(decodeAxeRun(raw));

    return result.violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(
        ({ id, impact, nodes }) =>
          `${impact} ${id} (${nodes.length}): ${nodes
            .slice(0, 3)
            .map(({ target }) => target.join(" "))
            .join(", ")}`
      );
  });

/** How far the page scrolls sideways, in px; 0 when it does not. */
export const sideways = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
  );
