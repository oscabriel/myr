/**
 * The repo's own docs are the public record (issue 707): AGENTS.md,
 * GLOSSARY.md, the ADRs and the agent docs point at nothing outside the
 * repo, AGENTS.md says what holds today, every decision has a numbered ADR
 * with a status, and the glossary defines the terms the code is written in.
 * File reads and string checks only.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, FileSystem, Order, Path, Schema } from "effect";

import { repoRoot } from "./root.ts";

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

/** Terms the code uses in public names, each of which GLOSSARY.md defines. */
const TERMS = [
  "Claim fork",
  "Decision",
  "Family",
  "Landed SHA",
  "Outcome",
  "Patch id",
  "Policy",
  "Proposal",
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
          PRIVATE.flatMap((pointer) =>
            text.includes(pointer) ? [`${path}: ${pointer}`] : []
          )
        )
      ).toStrictEqual([]);
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
