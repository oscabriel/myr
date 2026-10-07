import { describe, expect, it } from "@effect/vitest";
import { Context } from "effect";

import { Description, Destructive } from "../src/annotations.ts";
import { Contracts } from "../src/contracts.ts";

const contracts = [...Contracts.requests.values()];

describe("every contract's annotations", () => {
  it("describe what the contract does", () => {
    const undescribed = contracts.flatMap((rpc) =>
      Context.get(rpc.annotations, Description).trim() === "" ? [rpc._tag] : []
    );

    expect(contracts).not.toHaveLength(0);
    expect(undescribed).toStrictEqual([]);
  });

  // The default is false, so a destructive contract that says nothing would
  // tell an agent it is safe: every contract must decide.
  it("say whether the contract is destructive, never leaving it to the default", () => {
    const silent = contracts.flatMap((rpc) =>
      Context.getOrUndefined(rpc.annotations, Destructive) === undefined
        ? [rpc._tag]
        : []
    );

    expect(silent).toStrictEqual([]);
  });
});
