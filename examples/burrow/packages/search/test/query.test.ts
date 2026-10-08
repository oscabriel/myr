import assert from "node:assert/strict";
import { test } from "node:test";

import { API } from "@burrow/kit";
import { fakeTransport } from "@burrow/kit/testing";

import { search, searchAgain } from "../src/index.ts";

const { asked, transport } = fakeTransport(
  new Map([
    [
      `${API}/search?q=desk%20lamp`,
      JSON.stringify([
        { id: "p-2", score: 0.4 },
        { id: "p-1", score: 0.9 },
      ]),
    ],
  ])
);

test("puts the best hit first, and runs the last query again", async () => {
  const hits = await search("desk lamp", transport);
  const again = await searchAgain(transport);

  assert.deepEqual(
    hits.map(({ id }) => id),
    ["p-1", "p-2"]
  );
  assert.deepEqual(again, hits);
  assert.deepEqual(asked, [
    `${API}/search?q=desk%20lamp`,
    `${API}/search?q=desk%20lamp`,
  ]);
});
