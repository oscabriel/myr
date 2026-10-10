/**
 * An ask's reads, as the web's atoms make them.
 * Over the dev world in process (`dev-browser.ts`).
 */
import { describe, expect, it } from "@effect/vitest";
import { AskId } from "@repo/protocol/ids";
import { UnknownAsk } from "@repo/protocol/refusal";
import { Effect, Exit, Option, Schema } from "effect";

import { keys } from "../src/client/keys.ts";
import { ContractsClient } from "../src/surfaces.ts";
import { datekit, registryAs, seededWorld, settled } from "./dev-browser.ts";

describe("an ask, through the web's atoms", seededWorld, () => {
  it.live("refuses an ask the project never opened with UnknownAsk", () =>
    Effect.gen(function* () {
      const registry = registryAs();

      const unknown = AskId.make("no-such-ask");

      const shown = yield* settled(
        registry,
        ContractsClient.query(
          "showAsk",
          { ask: unknown, project: datekit },
          { reactivityKeys: keys.ask(datekit, unknown) }
        )
      );

      const error = Exit.isFailure(shown)
        ? Option.getOrUndefined(Exit.findErrorOption(shown))
        : undefined;

      expect(Schema.is(UnknownAsk)(error)).toBeTruthy();
    })
  );
});
