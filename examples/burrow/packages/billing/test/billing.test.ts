import assert from "node:assert/strict";
import { test } from "node:test";

import { API } from "@burrow/kit";
import { fakeTransport } from "@burrow/kit/testing";

import { invoiceLines, invoiceTotal, toUsdCents } from "../src/index.ts";

const { asked, transport } = fakeTransport(
  new Map([
    [`${API}/rates`, JSON.stringify({ EUR: 108, USD: 100 })],
    [
      `${API}/invoices/inv-7`,
      JSON.stringify([
        { cents: 1200, item: "seats" },
        { cents: 350, item: "storage" },
      ]),
    ],
  ])
);

test("converts to US cents with rates fetched once", async () => {
  assert.equal(await toUsdCents(10, "EUR", transport), 1080);
  assert.equal(await toUsdCents(10, "USD", transport), 1000);
  assert.equal(asked.filter((url) => url === `${API}/rates`).length, 1);
});

test("totals an invoice's lines", async () => {
  assert.equal(invoiceTotal(await invoiceLines("inv-7", transport)), 1550);
});
