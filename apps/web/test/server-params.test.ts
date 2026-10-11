/**
 * What a project route's server handler is handed as `params`. TanStack
 * Start runs every matched route's `params.parse` before a server handler
 * (`withParsedParams` in `@tanstack/start-server-core`'s
 * `createStartHandler`), so a handler under `$owner/$project` reads the
 * project's full name as `project`, once: parsing it again would name
 * `oscabriel/oscabriel/datekit`. Each case reads the params as Start does,
 * from the app's own router and rewrite.
 */
import { describe, expect, it } from "@effect/vitest";

import { getRouter } from "../src/router.tsx";
import { addressRewrite } from "../src/server/addresses.ts";

/** The params Start hands the server handler at `pathname`. */
const handedAt = (pathname: string) => {
  const router = getRouter();

  const url = addressRewrite.input?.({
    url: new URL(pathname, "https://web.test"),
  });

  const [matched, raw] = router.getMatchedRoutes(
    url instanceof URL ? url.pathname : pathname
  );

  const params = { ...raw };

  for (const route of matched) {
    const parse = route.options.params?.parse;

    if (parse !== undefined) {
      Object.assign(params, parse(params));
    }
  }

  return params;
};

describe("a project route's server handler", () => {
  it("is handed the project's full name as project, for an owner's project", () => {
    expect(handedAt("/oscabriel/datekit/llms.txt")).toMatchObject({
      owner: "oscabriel",
      project: "oscabriel/datekit",
    });
    expect(handedAt("/oscabriel/datekit/asks/format-ordinal.md")).toMatchObject(
      {
        project: "oscabriel/datekit",
      }
    );
  });

  it("is handed the project's full name as project, at its source namespace", () => {
    expect(handedAt("/github.com/pallets/click")).toMatchObject({
      owner: "github.com/pallets",
      project: "github.com/pallets/click",
    });
    expect(handedAt("/github.com/pallets/click/llms.txt")).toMatchObject({
      project: "github.com/pallets/click",
    });
  });
});
