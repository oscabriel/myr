import assert from "node:assert/strict";
import { test } from "node:test";

import { API } from "@burrow/kit";
import { fakeTransport } from "@burrow/kit/testing";

import { render } from "../src/index.ts";

const { transport } = fakeTransport(
  new Map([
    [`${API}/templates/welcome`, "Hello {{name}}, welcome to {{team}}."],
  ])
);

test("fills a template's slots, and leaves unknown ones as they are", async () => {
  assert.equal(
    await render("welcome", new Map([["name", "Wren"]]), transport),
    "Hello Wren, welcome to {{team}}."
  );
});
