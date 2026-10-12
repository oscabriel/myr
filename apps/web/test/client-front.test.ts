import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { keys } from "../src/client/keys.ts";
import { ContractsClient } from "../src/surfaces.ts";
import { registryAs, seededWorld, settled } from "./dev-browser.ts";

describe("the front page, through the web's atoms", seededWorld, () => {
  it.live(
    "lists every open ask of both projects on the front page, the newcomers' one untakeable",
    () =>
      Effect.gen(function* () {
        const registry = registryAs();

        const page = yield* settled(
          registry,
          ContractsClient.query(
            "frontPage",
            {},
            { reactivityKeys: keys.front() }
          )
        );

        expect(Exit.isSuccess(page)).toBeTruthy();

        const entries = Exit.isSuccess(page) ? page.value.entries : [];

        expect(
          entries
            .map(
              ({ ask, project, takeable }) =>
                `${project}/${ask.ask} ${takeable}`
            )
            .toSorted()
        ).toStrictEqual([
          "oscabriel/burrow/drop-legacy-fetch false",
          "oscabriel/burrow/drop-legacy-fetch-burrow-auth true",
          "oscabriel/burrow/drop-legacy-fetch-burrow-billing true",
          "oscabriel/burrow/drop-legacy-fetch-burrow-catalog true",
          "oscabriel/burrow/drop-legacy-fetch-burrow-kit true",
          "oscabriel/burrow/drop-legacy-fetch-burrow-notify true",
          "oscabriel/burrow/drop-legacy-fetch-burrow-search true",
          "oscabriel/datekit/add-months-clamp true",
          "oscabriel/datekit/format-ordinal false",
          "oscabriel/datekit/parse-iso-week false",
        ]);

        const reserved = entries.find(({ ask }) => ask.reserve !== undefined);

        expect(reserved?.ask.ask).toBe("format-ordinal");
        expect(reserved?.ask.reserve).toBe("newcomers");
        expect(reserved?.ask.claimed).toBeFalsy();
      })
  );
});
