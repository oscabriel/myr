import assert from "node:assert/strict";
import { test } from "node:test";

import { API } from "@burrow/kit";
import { fakeTransport } from "@burrow/kit/testing";

import { currentSession, isMember, signIn } from "../src/index.ts";

const session = { expiresAt: "2031-01-01T00:00:00Z", user: "wren" };

const { transport } = fakeTransport(
  new Map([
    [`${API}/sessions/t-1`, JSON.stringify(session)],
    [`${API}/teams/ops`, JSON.stringify(["wren", "tamsin"])],
  ])
);

test("signing in keeps the session as the current one", async () => {
  assert.deepEqual(await signIn("t-1", transport), session);
  assert.deepEqual(currentSession(), session);
});

test("a session's user is a member of the teams that list them", async () => {
  assert.equal(await isMember(session, "ops", transport), true);
});
