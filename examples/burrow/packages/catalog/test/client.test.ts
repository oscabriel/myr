import assert from "node:assert/strict";
import { test } from "node:test";

import { API } from "@burrow/kit";
import { fakeTransport } from "@burrow/kit/testing";

import { catalog } from "../src/index.ts";

const lamp = { id: "p-1", name: "Desk lamp", priceCents: 4500 };

const { transport } = fakeTransport(
  new Map([
    [`${API}/products/p-1`, JSON.stringify(lamp)],
    [`${API}/categories/lighting`, JSON.stringify([lamp])],
  ])
);

test("reads a product and a category", async () => {
  const client = catalog(transport);

  assert.deepEqual(await client.product("p-1"), lamp);
  assert.deepEqual(await client.category("lighting"), [lamp]);
});
