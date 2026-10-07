import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { Schema } from "effect";

import {
  CommandDoc,
  contractCommandDocs,
  localCommandDocs,
} from "../src/command-doc.ts";

const contract = contractCommandDocs(Contracts);

const all = [...contract, ...localCommandDocs];

const named = (words: string) =>
  all.filter(({ path }) => path.join(" ") === words);

describe(contractCommandDocs, () => {
  it("makes one row per CLI contract, from its annotations", () => {
    expect(named("claim")).toStrictEqual([
      {
        contract: "claim",
        flags: ["--project", "--json", "--dry-run"],
        needsApproval: false,
        path: ["claim"],
        positional: ["ask"],
        readOnly: false,
        source: "contract",
        summary:
          "Claim an ask: an exclusive, expiring right to answer it, with a fork to push to; claiming it again returns the same claim.",
      },
    ]);
  });

  it("splits a nested name into words, and gives a read no --dry-run", () => {
    expect(named("env shape")).toStrictEqual([
      {
        contract: "envShape",
        flags: ["--project", "--json"],
        needsApproval: false,
        path: ["env", "shape"],
        positional: [],
        readOnly: true,
        source: "contract",
        summary:
          "Show a project's env shape: the public schema of its environment variables, and who set each write-only value; never a value.",
      },
    ]);
  });

  it("gives a contract that needs approval --yes", () => {
    expect(named("vouch")[0]?.flags).toStrictEqual([
      "--handle",
      "--note",
      "--project",
      "--verdict",
      "--json",
      "--yes",
      "--dry-run",
    ]);
  });

  it("leaves out a stream, which has no command", () => {
    expect(contract.some(({ contract: tag }) => tag === "watch")).toBeFalsy();
  });

  it("leaves a contract to the local command that stands in for it", () => {
    expect(named("init")).toStrictEqual(
      localCommandDocs.filter(({ path }) => path.join(" ") === "init")
    );
    expect(named("env set")).toHaveLength(1);
    expect(named("env set")[0]?.source).toBe("local");
  });
});

describe("every command row", () => {
  it("is a CommandDoc", () => {
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((row) => !Schema.is(CommandDoc)(row))).toStrictEqual([]);
  });

  it("has a path no other row has", () => {
    const paths = all.map(({ path }) => path.join(" "));

    expect(paths).toStrictEqual([...new Set(paths)]);
  });

  it("includes each hand-written command the CLI has", () => {
    expect(
      localCommandDocs.map(({ path }) => path.join(" ")).toSorted()
    ).toStrictEqual([
      "check",
      "credential",
      "env set",
      "hook",
      "init",
      "login",
      "logout",
      "mcp",
      "schema",
      "why",
    ]);
  });
});
