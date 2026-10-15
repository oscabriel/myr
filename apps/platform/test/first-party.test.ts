import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { firstPartyOf } from "../src/auth/first-party.ts";

const origin = "https://platform.test";

const web = Option.some("https://web.test");

describe("the platform's own clients", () => {
  it("are the CLI's id on this platform and the web's id on its own address", () => {
    expect([
      firstPartyOf(`${origin}/oauth/cli`, origin, web),
      firstPartyOf("https://web.test/auth/client", origin, web),
      firstPartyOf(
        "https://web.test/auth/client",
        origin,
        Option.some("https://web.test/")
      ),
    ]).toStrictEqual(["cli", "web", "web"]);
  });

  it("are never told by a client's own name or path on another address", () => {
    expect([
      firstPartyOf("https://other.test/oauth/cli", origin, web),
      firstPartyOf("https://other.test/auth/client", origin, web),
      firstPartyOf("https://web.test.other.test/auth/client", origin, web),
      firstPartyOf(`${origin}/auth/client`, origin, web),
      firstPartyOf("https://web.test/auth/client", origin, Option.none()),
      firstPartyOf("https://web.test/auth/client", origin, Option.some("::")),
    ]).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
