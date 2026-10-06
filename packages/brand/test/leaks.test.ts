import { describe, expect, it } from "@effect/vitest";

import { Brand } from "../src/index.ts";
import { findLeaks } from "../src/leaks.ts";

describe(findLeaks, () => {
  it("flags the name in code outside the brand package, with its line", () => {
    const leaks = findLeaks([
      {
        content: `const a = 1;\nconst cli = "${Brand.slug}";\n`,
        path: "packages/protocol/src/x.ts",
      },
    ]);

    expect(leaks).toStrictEqual([
      {
        line: 2,
        path: "packages/protocol/src/x.ts",
        text: `const cli = "${Brand.slug}";`,
      },
    ]);
  });

  it("flags every derived spelling, whatever the case", () => {
    const content = [
      Brand.name.toUpperCase(),
      Brand.cliPackage,
      Brand.configDir,
      Brand.refsPrefix,
      Brand.gitRemoteHelper,
      Brand.urlScheme,
    ].join("\n");

    expect(findLeaks([{ content, path: "apps/cli/src/a.ts" }])).toHaveLength(6);
  });

  it("flags the name in a path", () => {
    const path = `examples/x/${Brand.configDir}/project.ts`;
    expect(findLeaks([{ content: "", path }])).toStrictEqual([
      { line: 0, path, text: path },
    ]);
  });

  it("allows the brand package, Markdown and licences", () => {
    const content = `${Brand.name} ${Brand.slug}`;
    expect(
      findLeaks([
        { content, path: "packages/brand/src/other.ts" },
        { content, path: "AGENTS.md" },
        { content, path: "docs/adr/0001-x.md" },
        { content, path: "LICENSES/x.MIT.txt" },
        { content, path: "LICENSE" },
      ])
    ).toStrictEqual([]);
  });

  it("ignores words that only contain the name", () => {
    const content = `${Brand.slug}iad ha${Brand.slug}`;
    expect(findLeaks([{ content, path: "packages/x/src/a.ts" }])).toStrictEqual(
      []
    );
  });

  it("skips the content of binary files", () => {
    const content = `\u0000${Brand.slug}`;
    expect(findLeaks([{ content, path: "assets/logo.png" }])).toStrictEqual([]);
  });
});
