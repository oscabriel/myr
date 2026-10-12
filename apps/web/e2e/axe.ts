import type { Page } from "@playwright/test";
import { Effect, Schema } from "effect";

const AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

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

export const axeOn = (page: Page) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => page.addScriptTag({ url: AXE }));

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

export const sideways = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
  );
