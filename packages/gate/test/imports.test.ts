import { describe, expect, it } from "@effect/vitest";
import { Territory } from "@repo/protocol/domain/territory";
import { RepoPath } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { importSpecifiers, reachedInternals } from "../src/imports.ts";

/** The text of `lines`, one per line, and each specifier it should give. */
const text = (...lines: readonly string[]) => lines.join("\n");

describe(importSpecifiers, () => {
  it.each([
    {
      found: [{ line: 1, specifier: "./week.ts" }],
      name: "a static import",
      text: 'import { week } from "./week.ts";',
    },
    {
      found: [{ line: 1, specifier: "@scope/b" }],
      name: "a type-only import, in single quotes",
      text: "import type { B } from '@scope/b';",
    },
    {
      found: [{ line: 4, specifier: "../format/src/pad.ts" }],
      name: "an import over several lines, on the line of its specifier",
      text: text(
        "import {",
        "  pad,",
        "  trim,",
        '} from "../format/src/pad.ts";'
      ),
    },
    {
      found: [
        { line: 1, specifier: "./x.ts" },
        { line: 2, specifier: "./y.ts" },
        { line: 3, specifier: "./z.ts" },
      ],
      name: "re-exports",
      text: text(
        'export { x } from "./x.ts";',
        'export * from "./y.ts";',
        'export * as z from "./z.ts";'
      ),
    },
    {
      found: [{ line: 1, specifier: "./polyfill.ts" }],
      name: "a side-effect import",
      text: 'import "./polyfill.ts";',
    },
    {
      found: [
        { line: 1, specifier: "./lazy.ts" },
        { line: 3, specifier: "./later.ts" },
      ],
      name: "dynamic imports, one over several lines",
      text: text(
        'const lazy = await import("./lazy.ts");',
        "const later = await import(",
        '  "./later.ts"',
        ");"
      ),
    },
    {
      found: [
        { line: 1, specifier: "node:fs" },
        { line: 2, specifier: "./config.cjs" },
      ],
      name: "require calls",
      text: text(
        'const fs = require("node:fs");',
        "import config = require('./config.cjs');"
      ),
    },
    {
      found: [{ line: 1, specifier: "../b/src/internal.ts" }],
      name: "the last line of an import whose first line is not in the text",
      text: '  trim } from "../b/src/internal.ts";',
    },
    {
      found: [{ line: 7, specifier: "./after.ts" }],
      name: "nothing in a comment",
      text: text(
        '// import { a } from "./line.ts";',
        '/* import("./block.ts") */',
        "/**",
        ' * import { b } from "./doc.ts";',
        ' * require("./doc.cjs")',
        " */",
        'import "./after.ts"; // import "./trailing.ts"'
      ),
    },
    {
      found: [],
      name: "nothing in a doc comment whose opening line is not in the text",
      text: text(' * import { b } from "./doc.ts";', " */"),
    },
    {
      found: [{ line: 3, specifier: "./real.ts" }],
      name: "nothing in a string, and no comment opened by one",
      text: text(
        "const said = \"import { a } from './quoted.ts'\";",
        'const slashes = "// not a comment", star = "/* nor this";',
        'import { real } from "./real.ts";'
      ),
    },
    {
      found: [{ line: 2, specifier: "./after.ts" }],
      name: "nothing in a regular expression",
      text: text(
        'const quote = /["\']/u, fake = /import\\("x"\\)/u;',
        'import { after } from "./after.ts";'
      ),
    },
    {
      found: [],
      name: "nothing that only looks like an import",
      text: text(
        'const chars = Array.from("abc");',
        'const doc = `import x from "./template.ts"`;',
        'const message = "copied from \\"./quoted.ts\\"";'
      ),
    },
  ])("finds $name", ({ found, text: source }) => {
    expect(importSpecifiers(source)).toStrictEqual(found);
  });
});

const modules = Schema.decodeSync(Schema.Array(Territory))([
  {
    module: "@scope/a",
    paths: ["packages/a/**"],
    publicFiles: ["packages/a/src/index.ts"],
  },
  {
    module: "@scope/b",
    paths: ["packages/b/**"],
    publicFiles: ["packages/b/src/index.ts", "packages/b/src/public.ts"],
  },
  { module: "@scope/c", paths: ["packages/c/**"] },
]);

const from = RepoPath.make("packages/a/src/x.ts");

const reached = (specifier: string) =>
  reachedInternals({ from, modules, specifier });

describe(reachedInternals, () => {
  it.each([
    "../../b/src/internal.ts",
    "../../b/src/deep/internal",
    "../../b/test/fixtures.ts",
    "../../b/package.json",
  ])("refuses %s, a file of another module it does not export", (specifier) => {
    expect(reached(specifier)).toStrictEqual(
      Option.some({ from, to: specifier })
    );
  });

  it.each([
    "@scope/b/src/internal",
    "@scope/b/src/index.ts",
    "@scope/b/test/fixtures",
    "@scope/b/internal/cache",
  ])(
    "refuses %s, a subpath of another module naming its src, test or internal folder",
    (specifier) => {
      expect(reached(specifier)).toStrictEqual(
        Option.some({ from, to: specifier })
      );
    }
  );

  it.each([
    "../../b/src/public.ts",
    "../../b/src/public.js",
    "../../b/src/index",
    "../../b/src",
    "../../b",
    "../../b/",
  ])(
    "allows %s, which lands on a file the other module exports",
    (specifier) => {
      expect(reached(specifier)).toStrictEqual(Option.none());
    }
  );

  it.each(["./y.ts", "../test/helper.ts", "../package.json", "@scope/a/src/y"])(
    "allows %s, inside the same module",
    (specifier) => {
      expect(reached(specifier)).toStrictEqual(Option.none());
    }
  );

  it.each([
    "@scope/b",
    "@scope/b/format",
    "effect",
    "effect/src/internal/core",
    "node:fs",
    "#internal/cache",
    "../../c/src/anything.ts",
    "../../../scripts/gen.ts",
  ])(
    "allows %s: a package's exports, a module listing no public files, or no module",
    (specifier) => {
      expect(reached(specifier)).toStrictEqual(Option.none());
    }
  );
});
