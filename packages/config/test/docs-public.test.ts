import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, FileSystem, Option, Order, Path, Schema } from "effect";

import { committable, readsAtOnce, repoRoot, textOf } from "./root.ts";

const PRIVATE_FOLDERS = [
  ".agents/adr",
  ".agents/demo",
  ".agents/ops",
  ".agents/workflow",
  ".agents/scratch",
  ".agents/README",
] as const;

const PRIVATE = [
  "~/",
  "/home/",
  "wanted-explainer",
  "plans.gneiss.run",
  ...PRIVATE_FOLDERS,
] as const;

/**
 * A reference into the build's private plan: a section of its spec
 * (`spec §8`, `W9 §14`), a decision (`spec D6`, `W9-D14`), an issue by wave
 * (`W3 313`), or the research synthesis (`SYN`).
 */
const PLAN_REFERENCES = [
  /\bspec §/u,
  /\bspec D\d/u,
  /\bW\d+ §/u,
  /\bW\d+-D\d/u,
  /\bW\d \d{3}\b/u,
  /\bSYN\b/u,
] as const;

const TEXT_FILE =
  /(?:\.(?:css|html|json|jsonc|md|mjs|sh|sql|toml|ts|tsx|ya?ml)|(?:^|\/)(?:\.gitignore|\.env\.schema|[^/]*Dockerfile))$/u;

/** This file, which spells the references out to find them. */
const QUOTES_THE_REFERENCES = "packages/config/test/docs-public.test.ts";

const planReferencesIn = (text: string) =>
  PLAN_REFERENCES.flatMap((reference) =>
    reference.test(text) ? [reference.source] : []
  );

/**
 * Where the private folders may be named: the maintainer's folder itself,
 * while it is still on disk, and `.gitignore`, which keeps it out.
 */
const NAMES_THE_PRIVATE_FOLDERS = (file: string) =>
  file.startsWith(".agents/") || file === ".gitignore";

const privateIn = (file: string, text: string) => [
  ...planReferencesIn(text),
  ...(NAMES_THE_PRIVATE_FOLDERS(file)
    ? []
    : PRIVATE_FOLDERS.filter((folder) => text.includes(folder))),
];

const TERMS = [
  "Claim fork",
  "Decision",
  "Family",
  "Landed SHA",
  "Outcome",
  "Owner",
  "Patch id",
  "Policy",
  "Project name",
  "Proposal",
  "Source namespace",
  "Today",
  "Working fork",
] as const;

const RootPackage = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

const read = (relative: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;

    return yield* fs.readFileString(path.join(root, relative));
  });

const withText = (paths: readonly string[]) =>
  Effect.forEach(paths, (path) =>
    Effect.map(read(path), (text) => ({ path, text }))
  );

const publicDocs = withText(["AGENTS.md", "GLOSSARY.md"]);

const sectionOf = (text: string, title: string): readonly string[] => {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${title}`);

  if (start === -1) {
    return [];
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2} /u.test(line));

  return end === -1 ? rest : rest.slice(0, end);
};

const commandOf = (line: string) =>
  /^- `(?<name>[^`\s]+)/u.exec(line)?.groups?.name;

describe("the repo's public docs", () => {
  it.live("point at no home folder and no private plan", () =>
    Effect.gen(function* () {
      const docs = yield* publicDocs;

      expect(
        docs.flatMap(({ path, text }) =>
          [
            ...PRIVATE.filter((pointer) => text.includes(pointer)),
            ...planReferencesIn(text),
          ].map((found) => `${path}: ${found}`)
        )
      ).toStrictEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "and no file the repo would commit cites the private plan or points into the private folders, comments included",
    () =>
      Effect.gen(function* () {
        const files = (yield* committable).filter(
          (file) => TEXT_FILE.test(file) && file !== QUOTES_THE_REFERENCES
        );

        const found = yield* Effect.forEach(
          files,
          (file) =>
            Effect.map(textOf(file), (text) =>
              Option.match(text, {
                onNone: () => [],
                onSome: (content) =>
                  privateIn(file, content).map(
                    (pattern) => `${file}: ${pattern}`
                  ),
              })
            ),
          readsAtOnce
        );

        expect(found.flat()).toStrictEqual([]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("AGENTS.md describes today, with no Day 0 paragraph", () =>
    Effect.gen(function* () {
      const agents = yield* read("AGENTS.md");

      expect(
        agents.split("\n").filter((line) => /\bDay 0\b/u.test(line))
      ).toStrictEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "AGENTS.md's Commands section names every root script, and only those",
    () =>
      Effect.gen(function* () {
        const agents = yield* read("AGENTS.md");

        const { scripts } = yield* Schema.decodeEffect(
          Schema.fromJsonString(RootPackage)
        )(yield* read("package.json"));

        expect(
          Array.sort(
            sectionOf(agents, "Commands").flatMap((line) => {
              const name = commandOf(line);

              return name === undefined ? [] : [name];
            }),
            Order.String
          )
        ).toStrictEqual(Array.sort(Object.keys(scripts), Order.String));
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("GLOSSARY.md defines each term the code uses", () =>
    Effect.gen(function* () {
      const glossary = (yield* read("GLOSSARY.md")).split("\n");

      expect(
        TERMS.filter((term) => !glossary.includes(`**${term}**:`))
      ).toStrictEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
