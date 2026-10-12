import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { npmMachineOf } from "../build-targets.ts";

describe("a compile target's machine, as npm names it", () => {
  it("reads the release's two targets, with or without Bun's prefix", () => {
    expect(npmMachineOf("bun-darwin-arm64")).toStrictEqual(
      Option.some({ cpu: "arm64", os: "darwin" })
    );
    expect(npmMachineOf("linux-x64")).toStrictEqual(
      Option.some({ cpu: "x64", os: "linux" })
    );
  });

  it("calls Windows win32, and drops Bun's modifiers", () => {
    expect(npmMachineOf("bun-windows-x64-baseline")).toStrictEqual(
      Option.some({ cpu: "x64", os: "win32" })
    );
    expect(npmMachineOf("linux-arm64-musl")).toStrictEqual(
      Option.some({ cpu: "arm64", os: "linux" })
    );
  });

  it("knows no machine for a target Bun does not name", () => {
    expect(npmMachineOf("bun-plan9-x64")).toStrictEqual(Option.none());
    expect(npmMachineOf("darwin")).toStrictEqual(Option.none());
  });
});
