/**
 * The repo's own docs are the public record: AGENTS.md, GLOSSARY.md, the
 * ADRs and the agent docs point at nothing outside the repo, AGENTS.md says
 * what holds today, every decision has a numbered ADR with a status, and the
 * glossary defines the terms the code is written in. No file the repo would
 * commit cites the build's private plan either, code comments included.
 * File reads and string checks only, beside one `git ls-files`.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, FileSystem, Option, Order, Path, Schema } from "effect";

import { committable, readsAtOnce, repoRoot, textOf } from "./root.ts";

/**
 * What a pointer to something only the maintainer can open looks like: a
 * home folder, the private research repo or the host that serves it, or the
 * build's own plan folder (gitignored).
 */
const PRIVATE = [
  "~/",
  "/home/",
  "wanted-explainer",
  "plans.gneiss.run",
  ".scratch/build",
] as const;

/**
 * What a reference into the build's private plan looks like, which a reader
 * with only the repo cannot follow: a section of its spec (`spec §8`, or a
 * wave's `W9 §14`), one of its decisions (`spec D6`, or a wave's `W9-D14`),
 * one of its issues by wave (`W3 313`), or the research synthesis it was
 * drawn from (`SYN`).
 */
const PLAN_REFERENCES = [
  /\bspec §/u,
  /\bspec D\d/u,
  /\bW\d+ §/u,
  /\bW\d+-D\d/u,
  /\bW\d \d{3}\b/u,
  /\bSYN\b/u,
] as const;

/** The files a reader opens as text: source, config, docs and scripts. */
const TEXT_FILE =
  /(?:\.(?:css|html|json|jsonc|md|mjs|sh|sql|toml|ts|tsx|ya?ml)|(?:^|\/)(?:\.gitignore|\.env\.schema|[^/]*Dockerfile))$/u;

/** This file, which spells the references out to find them. */
const QUOTES_THE_REFERENCES = "packages/config/test/docs-public.test.ts";

/** The plan references `text` makes, by their patterns. */
const planReferencesIn = (text: string) =>
  PLAN_REFERENCES.flatMap((reference) =>
    reference.test(text) ? [reference.source] : []
  );

/** Terms the code uses in public names, each of which GLOSSARY.md defines. */
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

/** A file's text, by its path from the repo root. */
const read = (relative: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;

    return yield* fs.readFileString(path.join(root, relative));
  });

/** The markdown files in a folder, by their paths from the repo root, in name order. */
const markdownIn = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const names = yield* fs.readDirectory(path.join(root, folder));

    return Array.sort(
      names.filter((name) => name.endsWith(".md")),
      Order.String
    ).map((name) => `${folder}/${name}`);
  });

/** Each file with its text. */
const withText = (paths: readonly string[]) =>
  Effect.forEach(paths, (path) =>
    Effect.map(read(path), (text) => ({ path, text }))
  );

/** Every public doc this test reads, with its text. */
const publicDocs = Effect.gen(function* () {
  return yield* withText([
    "AGENTS.md",
    "GLOSSARY.md",
    ...(yield* markdownIn("docs/adr")),
    ...(yield* markdownIn("docs/agents")),
  ]);
});

/** Frontmatter that opens the file and holds a `status:` line. */
const STATUS_FRONTMATTER =
  /^---\n(?:[^\n]*\n)*?status: \S[^\n]*\n(?:[^\n]*\n)*?---\n/u;

/** The lines of a `## <title>` section, up to the next heading of its level or above. */
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

/** The command a list item opens with: `ops` in "- `ops -- <command>`: …". */
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
    "and no file the repo would commit cites the private plan, comments included",
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
                  planReferencesIn(content).map(
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

  it.live("every ADR opens with a status line", () =>
    Effect.gen(function* () {
      const adrs = yield* withText(yield* markdownIn("docs/adr"));

      expect(
        adrs.flatMap(({ path, text }) =>
          STATUS_FRONTMATTER.test(text) ? [] : [path]
        )
      ).toStrictEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("ADRs are numbered from 0001 with no gap", () =>
    Effect.gen(function* () {
      const numbers = (yield* markdownIn("docs/adr")).map((path) =>
        path.slice("docs/adr/".length, "docs/adr/".length + 5)
      );

      expect(numbers).toStrictEqual(
        Array.makeBy(
          numbers.length,
          (index) => `${String(index + 1).padStart(4, "0")}-`
        )
      );
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
