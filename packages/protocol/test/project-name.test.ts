import { describe, expect, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";

import {
  isSourceNamespace,
  keyOf,
  nameOfKey,
  Owner,
  ownerOf,
  ProjectKey,
  ProjectName,
  projectAddressOf,
  projectNameOf,
  reservedProjectNames,
  ShortName,
  sourceHosts,
  sourceNamespaceOf,
  shortNameOf,
} from "../src/ids.ts";
import { legacyProjects } from "../src/legacy.ts";

const decode = Schema.decodeResult(ProjectName);

const decoded = (input: string) =>
  Result.match(decode(input), {
    onFailure: () => Option.none<string>(),
    onSuccess: (name) => Option.some<string>(name),
  });

describe("a project's name", () => {
  it.each([
    "oscabriel/datekit",
    "github.com/pallets/click",
    "codeberg.org/dnkl/fuzzel",
    "github.com/tj/commander.js",
    "alice/the_thing",
    "0day/x",
  ])("is an owner, then a short name: %j", (name) => {
    expect(decoded(name)).toStrictEqual(Option.some(name));
    expect(ProjectName.make(name)).toBe(name);
  });

  it("is lowercase, whatever the request spelled", () => {
    expect(decoded("OscaBriel/Datekit")).toStrictEqual(
      Option.some("oscabriel/datekit")
    );
    expect(decoded("GitHub.com/Pallets/Click")).toStrictEqual(
      Option.some("github.com/pallets/click")
    );
  });

  it("reads a legacy key as the name the table gives it", () => {
    expect(decoded("datekit")).toStrictEqual(Option.some("oscabriel/datekit"));
    expect(decoded("burrow")).toStrictEqual(Option.some("oscabriel/burrow"));
    expect(decoded("click")).toStrictEqual(
      Option.some("github.com/pallets/click")
    );
    expect(decoded("fuzzel")).toStrictEqual(
      Option.some("codeberg.org/dnkl/fuzzel")
    );
    expect(decoded("commander")).toStrictEqual(
      Option.some("github.com/tj/commander")
    );
  });

  it.each([
    "foo",
    "smoke-20251010",
    "docs/foo",
    "import/foo",
    "people/foo",
    "github.com/foo",
    "gitlab.com/a/b/c",
    "example.com/a/b",
    "oscabriel/foo--bar",
    "oscabriel/LLMS.txt",
    "oscabriel/notes.md",
    "oscabriel/-foo",
    "oscabriel/foo.",
    "a--b/foo",
    "oscabriel/",
    "/datekit",
    "oscabriel/datekit/",
    "",
  ])("refuses %j", (input) => {
    expect(decoded(input)).toStrictEqual(Option.none());
  });

  it("is made only in its full form", () => {
    expect(() => ProjectName.make("datekit")).toThrow(
      "Schema validation failed"
    );
    expect(() => ProjectName.make("Oscabriel/datekit")).toThrow(
      "Schema validation failed"
    );
  });

  it("encodes to the full name, never to a key", () => {
    expect(
      Schema.encodeSync(ProjectName)(ProjectName.make("oscabriel/datekit"))
    ).toBe("oscabriel/datekit");
  });

  it("is a string with a pattern in JSON Schema, with no null in it", () => {
    const json = JSON.stringify(Schema.toJsonSchemaDocument(ProjectName));

    expect(json).toContain('"type":"string"');
    expect(json).toContain('"pattern"');
    expect(json).not.toContain("null");
  });

  it("splits into its owner and its short name", () => {
    const name = ProjectName.make("github.com/pallets/click");

    expect(ownerOf(name)).toBe("github.com/pallets");
    expect(shortNameOf(name)).toBe("click");
    expect(ownerOf(ProjectName.make("oscabriel/datekit"))).toBe("oscabriel");
    expect(
      projectNameOf(Owner.make("oscabriel"), ShortName.make("datekit"))
    ).toBe("oscabriel/datekit");
  });
});

describe("an owner", () => {
  it("is a handle or a source namespace, never both", () => {
    expect(isSourceNamespace(Owner.make("oscabriel"))).toBeFalsy();
    expect(isSourceNamespace(Owner.make("github.com/pallets"))).toBeTruthy();
    expect(Schema.is(Owner)("github.com")).toBeFalsy();
    expect(Schema.is(Owner)("docs")).toBeFalsy();
  });

  it("is read from an import's URL when its host is one the platform knows", () => {
    expect(
      sourceNamespaceOf("https://github.com/Pallets/click.git")
    ).toStrictEqual(Option.some("github.com/pallets"));
    expect(sourceNamespaceOf("https://codeberg.org/dnkl/fuzzel")).toStrictEqual(
      Option.some("codeberg.org/dnkl")
    );
    expect(sourceNamespaceOf("https://example.com/a/b")).toStrictEqual(
      Option.none()
    );
    expect(sourceNamespaceOf("https://github.com/pallets")).toStrictEqual(
      Option.none()
    );
    expect(sourceHosts).toContain("gitlab.com");
  });

  // ADR 0041: the pages the redesign adds, and the old ones kept for their redirects.
  it("is never a page the four shells add, nor one kept for its redirect", () => {
    expect(reservedProjectNames).toStrictEqual(
      expect.arrayContaining([
        "agents",
        "explore",
        "home",
        "inbox",
        "install",
        "settings",
        "today",
        "tour",
      ])
    );
  });

  it("is never a word the web serves its own pages at", () => {
    expect(reservedProjectNames).toContain("import");

    for (const word of reservedProjectNames) {
      expect(decoded(`${word}/foo`)).toStrictEqual(Option.none());
    }
  });
});

describe("a project's key", () => {
  it("is the name with its slashes made underscores", () => {
    expect(keyOf(ProjectName.make("oscabriel/foo"))).toBe("oscabriel__foo");
    expect(keyOf(ProjectName.make("github.com/pallets/werkzeug"))).toBe(
      "github.com__pallets__werkzeug"
    );
  });

  it("is the legacy key for a project made before owners", () => {
    expect(keyOf(ProjectName.make("oscabriel/datekit"))).toBe("datekit");
    expect(keyOf(ProjectName.make("github.com/pallets/click"))).toBe("click");
  });

  it("reverses to the name, and to nothing for a key no project has", () => {
    expect(nameOfKey(ProjectKey.make("datekit"))).toStrictEqual(
      Option.some("oscabriel/datekit")
    );
    expect(nameOfKey(ProjectKey.make("oscabriel__foo"))).toStrictEqual(
      Option.some("oscabriel/foo")
    );
    expect(
      nameOfKey(ProjectKey.make("github.com__pallets__werkzeug"))
    ).toStrictEqual(Option.some("github.com/pallets/werkzeug"));
    expect(nameOfKey(ProjectKey.make("smoke-20251010"))).toStrictEqual(
      Option.none()
    );
    expect(nameOfKey(ProjectKey.make("docs_foo"))).toStrictEqual(Option.none());
  });

  it("round-trips every legacy row and every new name", () => {
    for (const { key, name } of legacyProjects) {
      expect(keyOf(ProjectName.make(name))).toBe(key);
      expect(nameOfKey(ProjectKey.make(key))).toStrictEqual(Option.some(name));
    }

    expect(() => ProjectKey.make("a--b")).toThrow("Schema validation failed");
  });
});

describe("the legacy table", () => {
  it("names the two examples and the imports, each key once", () => {
    const keys = legacyProjects.map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("datekit");
    expect(keys).toContain("burrow");
    expect(keys).toHaveLength(40);
  });
});

const addressOf = (path: string) =>
  Option.map(
    projectAddressOf(path.split("/").filter((segment) => segment !== "")),
    ({ legacy, rest, spelled }) => ({ legacy, rest: rest.join("/"), spelled })
  );

describe("a project's address", () => {
  it.each([
    ["/oscabriel/datekit/tree/main", "oscabriel/datekit", "tree/main", false],
    ["/github.com/pallets/click", "github.com/pallets/click", "", false],
    [
      "/GitHub.com/Pallets/click/asks/x",
      "GitHub.com/Pallets/click",
      "asks/x",
      false,
    ],
    ["/datekit/ledger", "datekit", "ledger", true],
    ["/Click", "Click", "", true],
  ])("reads %j as its name and its page", (path, spelled, rest, legacy) => {
    expect(addressOf(path)).toStrictEqual(
      Option.some({ legacy, rest, spelled })
    );
  });

  it.each(["/", "/oscabriel", "/github.com/pallets"])(
    "reads nothing in %j, too short for a name",
    (path) => {
      expect(addressOf(path)).toStrictEqual(Option.none());
    }
  );
});

describe("a key of a name whose segments hold underscores", () => {
  it("reads back to its name", () => {
    const name = ProjectName.make("alice/the_thing");

    expect(nameOfKey(keyOf(name))).toStrictEqual(Option.some(name));
  });

  it("is not another name's key", () => {
    expect(keyOf(ProjectName.make("github.com/a_b/c"))).not.toBe(
      keyOf(ProjectName.make("github.com/a/b_c"))
    );
  });
});
