/**
 * What the model reads: `pickFiles` over a project's canonical tree, the
 * same every time, within its byte budget, and never a layer's path.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { RepoPath } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { askTestFolderOf, pickFiles } from "../src/context.ts";

const askFile = (id: string) => `${Brand.configDir}/asks/${id}.ask.ts`;

const askSource = (id: string) =>
  `export default kinds.fix.ask({\n  path: "test/asks/${id}.test.ts",\n  want: "w",\n});\n`;

/** A datekit-shaped tree, with what each file holds. */
const files = {
  ".github/workflows/ci.yml": "steps: []\n",
  "README.md": "# datekit\n",
  [askFile("add-months-clamp")]: askSource("add-months-clamp"),
  [askFile("format-ordinal")]: askSource("format-ordinal"),
  [`${Brand.configDir}/layers/maintainers/notes.md`]: "sealed notes\n",
  [`${Brand.configDir}/project.ts`]: "export default project({});\n",
  "checks/held-back/export/offsets.test.ts": "sealed\n",
  "docs/README.md": "# docs\n",
  "package.json": '{ "name": "datekit" }\n',
  "src/add.ts": "export const addMonths = () => 0;\n",
  "src/format.ts": "export const format = () => '';\n",
  "src/parse.ts": "export const parseISO = () => 0;\n",
  "src/tz.ts": "export const zone = () => 0;\n",
  "test/add.test.ts": "it('adds')\n",
  "test/asks/add-months-clamp.test.ts": "it('clamps')\n",
  "test/asks/format-ordinal.test.ts": "it('ordinals')\n",
  "test/format.test.ts": "it('formats')\n",
  "test/parse.test.ts": "it('parses')\n",
} as const satisfies Readonly<Record<string, string>>;

const tree = Object.keys(files).map((path) => RepoPath.make(path));

const read = (contents: Readonly<Record<string, string>>) => (path: RepoPath) =>
  Effect.succeed(contents[path] ?? "");

const pathsOf = (picked: readonly { readonly path: string }[]) =>
  picked.map(({ path }) => path);

describe("the files a draft reads", () => {
  it.effect("picks the same files for the same tree and want, twice", () =>
    Effect.gen(function* () {
      const want = { want: "addMonths clamps to the end of a short month" };
      const first = yield* pickFiles(tree, want, read(files));

      const second = yield* pickFiles(
        [...tree].toReversed(),
        want,
        read(files)
      );

      expect(first).toStrictEqual(second);
      expect(pathsOf(first)).toStrictEqual([
        askFile("format-ordinal"),
        "test/asks/format-ordinal.test.ts",
        "README.md",
        "package.json",
        `${Brand.configDir}/project.ts`,
        "src/add.ts",
        "test/add.test.ts",
        "docs/README.md",
      ]);
    })
  );

  it.effect("reads the territory's files when the want names one", () =>
    Effect.gen(function* () {
      const picked = yield* pickFiles(
        tree,
        { territory: [RepoPath.make("src/parse.ts")], want: "Week dates" },
        read(files)
      );

      expect(pathsOf(picked)).toContain("src/parse.ts");
      expect(pathsOf(picked)).toContain("test/parse.test.ts");
      expect(pathsOf(picked)).not.toContain("src/add.ts");
    })
  );

  it.effect("never picks a path under a layer or a held-back folder", () =>
    Effect.gen(function* () {
      const picked = yield* pickFiles(
        tree,
        {
          territory: [
            RepoPath.make("checks"),
            RepoPath.make(`${Brand.configDir}/layers`),
          ],
          want: "held back offsets notes maintainers export",
        },
        read(files)
      );

      expect(
        pathsOf(picked).filter(
          (path) =>
            path.includes("held-back/") ||
            path.startsWith(`${Brand.configDir}/layers/`)
        )
      ).toStrictEqual([]);
    })
  );

  it.effect(
    "cuts a 300 KB file at 40 KB with its marker, within the budget",
    () =>
      Effect.gen(function* () {
        const big = "x".repeat(300 * 1024);

        const many = Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [
            `src/add-${index}.ts`,
            "y".repeat(30 * 1024),
          ])
        );

        const contents = { ...files, ...many, "src/add-big.ts": big };

        const picked = yield* pickFiles(
          Object.keys(contents).map((path) => RepoPath.make(path)),
          { want: "the big add" },
          read(contents)
        );

        const bytes = picked.reduce(
          (sum, { content }) => sum + new TextEncoder().encode(content).length,
          0
        );

        expect(bytes).toBeLessThanOrEqual(200 * 1024);

        const cut = picked.find(({ path }) => path === "src/add-big.ts");

        expect(cut?.content.startsWith("x".repeat(40 * 1024))).toBeTruthy();
        expect(cut?.content.slice(40 * 1024)).toBe(
          "\n[cut: the first 40960 of 307200 bytes]\n"
        );
      })
  );

  it.effect(
    "always shows an existing ask and its test as the style example",
    () =>
      Effect.gen(function* () {
        const picked = yield* pickFiles(
          tree,
          { want: "time zones" },
          read(files),
          1024
        );

        expect(pathsOf(picked)).toContain(askFile("format-ordinal"));
        expect(pathsOf(picked)).toContain("test/asks/format-ordinal.test.ts");
        expect(askTestFolderOf(picked)).toStrictEqual(Option.some("test/asks"));
      })
  );

  it.effect(
    "keeps the style example when a long README would spend the budget first",
    () =>
      Effect.gen(function* () {
        const contents = { ...files, "README.md": "r".repeat(300 * 1024) };

        const picked = yield* pickFiles(
          tree,
          { want: "time zones" },
          read(contents),
          8 * 1024
        );

        expect(pathsOf(picked).slice(0, 2)).toStrictEqual([
          askFile("format-ordinal"),
          "test/asks/format-ordinal.test.ts",
        ]);
        expect(askTestFolderOf(picked)).toStrictEqual(Option.some("test/asks"));
      })
  );
});
