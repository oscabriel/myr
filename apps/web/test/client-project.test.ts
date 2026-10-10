/**
 * A project page's reads, as the web's atoms make them: its open asks,
 * and its events, replayed and folded.
 * Over the dev world in process (`dev-browser.ts`).
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectName } from "@repo/protocol/ids";
import { Effect, Exit } from "effect";

import {
  projectEventsAtom,
  recentLandings,
  recentLandingsAtom,
} from "../src/client/events.ts";
import { keys } from "../src/client/keys.ts";
import { familyEventsAtom, projectsKey } from "../src/client/project.ts";
import { ContractsClient } from "../src/surfaces.ts";
import { datekit, registryAs, seededWorld, settled } from "./dev-browser.ts";

const burrow = ProjectName.make("burrow");

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

describe(
  "the events of the projects a page's families are in",
  seededWorld,
  () => {
    it.live(
      "reads each project's replay once, keyed by the projects together",
      () =>
        Effect.gen(function* () {
          const registry = registryAs();
          const key = projectsKey([burrow, datekit]);

          yield* settled(registry, projectEventsAtom(burrow));
          yield* settled(registry, projectEventsAtom(datekit));

          const read = registry.get(familyEventsAtom(key));

          expect(key).toBe("burrow datekit");
          expect([...read.keys()]).toStrictEqual([burrow, datekit]);
          expect(read.get(datekit)?.length).toBeGreaterThan(0);
        })
    );
  }
);
