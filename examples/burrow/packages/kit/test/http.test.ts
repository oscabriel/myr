import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { API, http, isHealthy, legacyFetch } from "../src/index.ts";
import { fakeTransport } from "../src/testing.ts";

const routes = new Map([
  [`${API}/greeting`, "hello"],
  [`${API}/search/health`, "ok"],
]);

describe("http.get", () => {
  test("gives the body of a success", async () => {
    const { transport } = fakeTransport(routes);

    assert.deepEqual(await http.get(`${API}/greeting`, transport), {
      ok: true,
      text: "hello",
    });
  });

  test("gives the status of a failure, without throwing", async () => {
    const { transport } = fakeTransport(routes);

    assert.deepEqual(await http.get(`${API}/missing`, transport), {
      ok: false,
      status: 404,
    });
  });
});

describe("legacyFetch", () => {
  test("throws on a failure", async () => {
    const { transport } = fakeTransport(routes);

    await assert.rejects(legacyFetch(`${API}/missing`, transport), /404/u);
  });
});

describe("isHealthy", () => {
  test("is true for a service that answers, false for one that doesn't", async () => {
    const { transport } = fakeTransport(routes);

    assert.equal(await isHealthy("search", transport), true);
    assert.equal(await isHealthy("billing", transport), false);
  });
});
