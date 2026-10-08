import { describe, expect, it } from "@effect/vitest";
import { Contracts } from "@repo/protocol/contracts";
import { Schema } from "effect";

import {
  CommandDoc,
  commandDocs,
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
      "today",
      "why",
    ]);
  });
});

/** Each row that calls `tag`, by its words and where it comes from. */
const calling = (docs: readonly CommandDoc[], tag: string) =>
  docs.flatMap((doc) =>
    doc.contract === tag ? [`${doc.path.join(" ")} (${doc.source})`] : []
  );

// The one list the platform's skill, the CLI's MCP prompt and the web's
// `llms.txt` read: every command once, in the order a person scans for one.
describe(commandDocs, () => {
  const docs = commandDocs(Contracts);
  const words = docs.map(({ path }) => path.join(" "));

  it("lists every command the CLI has, from a contract or written by hand", () => {
    const byName = new Map(docs.map((doc) => [doc.path.join(" "), doc]));

    expect(docs).toHaveLength(contract.length + localCommandDocs.length);
    expect(byName.get("asks")).toMatchObject({
      contract: "listAsks",
      needsApproval: false,
      positional: [],
      readOnly: true,
      source: "contract",
    });
    expect(
      [
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
      ].map((name) => [name, byName.get(name)?.source])
    ).toStrictEqual([
      ["check", "local"],
      ["credential", "local"],
      ["env set", "local"],
      ["hook", "local"],
      ["init", "local"],
      ["login", "local"],
      ["logout", "local"],
      ["mcp", "local"],
      ["schema", "local"],
      ["why", "local"],
    ]);
  });

  it("sorts the commands by their words, so a command's subcommands follow it", () => {
    expect(
      words.filter((name) => name.startsWith("ask") || name.startsWith("env"))
    ).toStrictEqual([
      "ask",
      "ask flag",
      "ask open",
      "asks",
      "env set",
      "env shape",
    ]);
    expect(words.slice(0, 3)).toStrictEqual(["ask", "ask flag", "ask open"]);
  });

  // `init` and `env set` do local work around the contract they call, so
  // their hand-written rows stand for those contracts.
  it("gives a contract a hand-written command calls no row of its own", () => {
    expect(calling(docs, "initProject")).toStrictEqual(["init (local)"]);
    expect(calling(docs, "setEnv")).toStrictEqual(["env set (local)"]);
  });
});
