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
    const path = `packages/x/${Brand.configDir}/project.ts`;
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
        { content, path: "apps/web/src/components/ui/LICENSE" },
        { content, path: "apps/web/src/assets/fonts/LICENSE-x.txt" },
        { content, path: "LICENSE" },
      ])
    ).toStrictEqual([]);
  });

  // Nothing in the repo is written from the brand any more, so no folder
  // outside the brand package and prose may spell it.
  it("flags the name in a plugin's or a skill's JSON like any other file", () => {
    const content = `${Brand.cli} asks`;

    expect(
      findLeaks([
        { content, path: "skills/contribute/hooks.json" },
        { content, path: "plugins/claude-code/plugin.json" },
      ]).map(({ path }) => path)
    ).toStrictEqual([
      "skills/contribute/hooks.json",
      "plugins/claude-code/plugin.json",
    ]);
  });

  it("allows an example's config folder, name and all", () => {
    const content = `import { project } from "${Brand.npmScope}/sdk";`;
    const path = `examples/datekit/${Brand.configDir}/project.ts`;

    expect(findLeaks([{ content, path }])).toStrictEqual([]);
  });

  it("allows the config folder of an example's layer, at the layer repo's root", () => {
    const content = `import { layerManifest } from "${Brand.npmScope}/cli/rules";`;

    expect(
      findLeaks([
        {
          content,
          path: `examples/datekit/layers/maintainers/${Brand.configDir}/layer.ts`,
        },
        {
          content,
          path: `examples/datekit/layers/maintainers/checks/${Brand.configDir}/a.test.ts`,
        },
        {
          content,
          path: "examples/datekit/layers/maintainers/checks/a.test.ts",
        },
        {
          content,
          path: `examples/datekit/layers/${Brand.configDir}/layer.ts`,
        },
      ]).map((leak) => [leak.path, leak.line])
    ).toStrictEqual([
      [
        `examples/datekit/layers/maintainers/checks/${Brand.configDir}/a.test.ts`,
        0,
      ],
      [
        `examples/datekit/layers/maintainers/checks/${Brand.configDir}/a.test.ts`,
        1,
      ],
      ["examples/datekit/layers/maintainers/checks/a.test.ts", 1],
      [`examples/datekit/layers/${Brand.configDir}/layer.ts`, 0],
      [`examples/datekit/layers/${Brand.configDir}/layer.ts`, 1],
    ]);
  });

  it("still flags the name in an example's own code", () => {
    const content = `const cli = "${Brand.cli}";`;

    expect(
      findLeaks([
        { content, path: "examples/datekit/src/index.ts" },
        {
          content,
          path: `examples/datekit/src/${Brand.configDir}/project.ts`,
        },
        { content, path: "docs/guide/setup.ts" },
      ]).map((leak) => [leak.path, leak.line])
    ).toStrictEqual([
      ["examples/datekit/src/index.ts", 1],
      [`examples/datekit/src/${Brand.configDir}/project.ts`, 0],
      [`examples/datekit/src/${Brand.configDir}/project.ts`, 1],
      ["docs/guide/setup.ts", 1],
    ]);
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
