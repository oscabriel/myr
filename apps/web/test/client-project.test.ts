/**
 * A project page's reads, as the web's atoms make them: its open asks,
 * and its events, replayed and folded.
 * Over the dev world in process (`dev-browser.ts`).
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import {
  projectEventsAtom,
  recentLandings,
  recentLandingsAtom,
} from "../src/client/events.ts";
import { keys } from "../src/client/keys.ts";
import { ContractsClient } from "../src/surfaces.ts";
import { datekit, registryAs, seededWorld, settled } from "./dev-browser.ts";

describe("a project's page, through the web's atoms", seededWorld, () => {
  it.live("lists a project's asks", () =>
    Effect.gen(function* () {
      const registry = registryAs();

      const listed = yield* settled(
        registry,
        ContractsClient.query(
          "listAsks",
          { project: datekit },
          { reactivityKeys: keys.project(datekit) }
        )
      );

      expect(
        Exit.isSuccess(listed)
          ? listed.value.asks.map(({ ask }) => ask).toSorted()
          : []
      ).toStrictEqual(["add-months-clamp", "format-ordinal", "parse-iso-week"]);
    })
  );

  it.live(
    "replays a project's events once, its landings read from the same replay",
    () =>
      Effect.gen(function* () {
        const registry = registryAs();
        const events = yield* settled(registry, projectEventsAtom(datekit));
        const landings = yield* settled(registry, recentLandingsAtom(datekit));

        const replayed = Exit.isSuccess(events) ? events.value : [];

        expect(replayed.length).toBeGreaterThan(0);
        expect(
          Exit.isSuccess(landings)
            ? landings.value.map(({ sha }) => sha)
            : undefined
        ).toStrictEqual(recentLandings(replayed).map(({ sha }) => sha));
      })
  );
});
