/**
 * The demo folder (issue 713). On recording day the user opens `docs/demo/`
 * and finds a narration script timed to the video's seven beats, a shot list,
 * the swarm scenario and a rehearsal checklist that the live walk marks.
 *
 * Every command those files show is one that exists: each line of a `sh`
 * block runs Bun, git, the CLI or one of the harnesses; each `bun run <x>`
 * is a root script and each `bun <file>` a file in the repo; each CLI line is
 * a command in `commandDocs(Contracts)`, the CLI's one command list, with
 * flags it takes. The shot list's own commands obey the same rules, every
 * shot is on the `demo` stage, and the rehearsal has one checkbox per shot.
 *
 * Each file's presence is asserted before it is read, so a missing file is a
 * failed assertion, not a load error.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import { blankJsonc } from "../../../infra/jsonc.ts";
import {
  platformOrigin,
  subdomainFile,
  webOrigin,
  WorkersDev,
} from "../../../infra/stages.ts";
import { commandDocs } from "../../agent-kit/src/command-doc.ts";
import type { CommandDoc } from "../../agent-kit/src/command-doc.ts";
import { Brand } from "../../brand/src/index.ts";
import { Contracts } from "../../protocol/src/contracts.ts";
import { repoRoot } from "./root.ts";

/** The folder, from the repo root, and the four files the user records from. */
const DEMO = "docs/demo";

const DEMO_FILES = [
  "rehearsal.md",
  "script.md",
  "shot-list.md",
  "swarm-scenario.md",
] as const;

/** A file under the repo root, as text, once its presence is asserted. */
const presentText = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const at = path.join(yield* repoRoot, file);

    expect(yield* fs.exists(at), `${file} exists`).toBeTruthy();

    return yield* fs.readFileString(at);
  });

/** Whether `file`, relative to the repo root, is on disk. */
const existsInRepo = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.exists(path.join(yield* repoRoot, file));
  });

/** Every Markdown file in the demo folder, by its path from the repo root. */
const demoMarkdown = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(path.join(yield* repoRoot, DEMO));

  return names
    .filter((name) => name.endsWith(".md"))
    .toSorted()
    .map((name) => `${DEMO}/${name}`);
});

const RootPackage = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

/** The names `bun run <name>` can run from the repo root. */
const rootScripts = Effect.gen(function* () {
  const text = yield* presentText("package.json");

  const { scripts } = yield* Schema.decodeEffect(
    Schema.fromJsonString(RootPackage)
  )(text);

  return new Set(Object.keys(scripts));
});

// A beat's H2: its title, then its range on the video's clock, `0:45–1:30`.
const BEAT =
  /^## (?<title>.+?) \((?<fromMinutes>\d+):(?<fromSeconds>[0-5]\d)–(?<toMinutes>\d+):(?<toSeconds>[0-5]\d)\)$/u;

/** One beat of the script: its title and its range, in seconds. */
interface Beat {
  readonly from: number;
  readonly title: string;
  readonly to: number;
}

/** The script's H2s that read as beats, and those that don't. */
const beatsOf = (script: string) => {
  const headings = script.split("\n").filter((line) => line.startsWith("## "));

  const beats = headings.flatMap((line): readonly Beat[] => {
    const groups = BEAT.exec(line)?.groups;

    return groups === undefined
      ? []
      : [
          {
            from: Number(groups.fromMinutes) * 60 + Number(groups.fromSeconds),
            title: groups.title ?? "",
            to: Number(groups.toMinutes) * 60 + Number(groups.toSeconds),
          },
        ];
  });

  return {
    beats,
    unranged: headings.filter((line) => !BEAT.test(line)),
  };
};

/** Where a beat's range breaks the clock: a gap, an overlap or a backwards range. */
const clockBreaks = (beats: readonly Beat[]) =>
  beats.flatMap((beat, index) => {
    const startsAt = index === 0 ? 0 : (beats[index - 1]?.to ?? -1);

    return [
      ...(beat.from === startsAt
        ? []
        : [`${beat.title} starts at ${beat.from}s, not ${startsAt}s`]),
      ...(beat.to > beat.from ? [] : [`${beat.title} ends before it starts`]),
    ];
  });

// A fenced `sh` block, possibly indented under a list item.
const SH_FENCE = /^[ \t]*```sh\n(?<body>[\s\S]*?)^[ \t]*```[ \t]*$/gmu;

/** Every non-blank line of every `sh` block in `text`, trimmed. */
const shLines = (text: string) =>
  [...text.matchAll(SH_FENCE)].flatMap((match) =>
    (match.groups?.body ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
  );

// `bunx varlock run --path <dir> -- <command>`: varlock loads a schema's
// values into the command's env (the swarm's people, the seed's tokens), so
// the command after `--` is the one the rules read.
const VARLOCK = /^bunx varlock run(?: --path \S+)? -- (?<inner>.+)$/u;

/** The command a line runs: itself, or the one varlock wraps. */
const commandOf = (line: string) => VARLOCK.exec(line)?.groups?.inner ?? line;

/** The programs a demo command may start with. */
const PROGRAMS = new Set([
  "amp",
  "bun",
  "cd",
  "claude",
  "export",
  "git",
  "herdr",
  "opencode",
  "pi",
  Brand.cli,
]);

/** Shell that would run a second command the rules never read. */
const CHAINED = /&&|\|\||\s\|\s/u;

/** A line's first word, the program it runs. */
const programOf = (line: string) => commandOf(line).split(/\s+/u)[0] ?? "";

/** Why `line` may not appear in a demo command, if it may not. */
const programProblem = (line: string): readonly string[] => {
  if (CHAINED.test(line)) {
    return [`${line}: chains a second command`];
  }

  return PROGRAMS.has(programOf(line))
    ? []
    : [`${line}: starts with ${programOf(line)}`];
};

/** The root scripts a line runs with `bun run <name>`. */
const scriptsIn = (line: string) =>
  [...line.matchAll(/\bbun run (?<name>\S+)/gu)].map(
    (match) => match.groups?.name ?? ""
  );

/** The files a line runs with `bun <file>`. */
const filesIn = (line: string) =>
  [...line.matchAll(/(?:^|\s)bun (?<file>[\w./-]+\.[cm]?[jt]s)(?=\s|$)/gu)].map(
    (match) => match.groups?.file ?? ""
  );

/** The CLI command a line runs, as its words after the CLI's name, if it runs one. */
const cliWordsOf = (line: string): readonly string[] | undefined => {
  const [program, ...words] = commandOf(line).split(/\s+/u);

  return program === Brand.cli ? words : undefined;
};

/** The command whose words start `words`, the longest one when several do. */
const commandFor = (
  docs: readonly CommandDoc[],
  words: readonly string[]
): CommandDoc | undefined =>
  docs
    .filter((doc) => doc.path.every((word, index) => words[index] === word))
    .toSorted((one, other) => other.path.length - one.path.length)[0];

/** The flags `words` give before a bare `--`, without their `=value`. */
const flagsIn = (words: readonly string[]) => {
  const end = words.indexOf("--");

  return (end === -1 ? words : words.slice(0, end))
    .filter((word) => word.startsWith("--"))
    .map((word) => word.split("=")[0] ?? word);
};

/** Why a CLI line names no command the CLI has, or a flag its command lacks. */
const cliProblem = (
  docs: readonly CommandDoc[],
  line: string
): readonly string[] => {
  const words = cliWordsOf(line);

  if (words === undefined) {
    return [];
  }

  const doc = commandFor(docs, words);

  if (doc === undefined) {
    return [`${line}: no ${Brand.cli} command ${words[0] ?? ""}`];
  }

  return flagsIn(words.slice(doc.path.length))
    .filter((flag) => !doc.flags.includes(flag))
    .map((flag) => `${line}: ${doc.path.join(" ")} takes no ${flag}`);
};

/** Why a line's `bun run` scripts or `bun` files don't exist, if they don't. */
const bunProblems = (scripts: ReadonlySet<string>, line: string) =>
  Effect.gen(function* () {
    const missingScripts = scriptsIn(line)
      .filter((name) => !scripts.has(name))
      .map((name) => `${line}: no root script ${name}`);

    const missingFiles: string[] = [];

    for (const file of filesIn(line)) {
      if (!(yield* existsInRepo(file))) {
        missingFiles.push(`${line}: no file ${file}`);
      }
    }

    return [...missingScripts, ...missingFiles];
  });

/** Every problem a command line has: its program, its scripts, files and CLI command. */
const commandProblems = (
  docs: readonly CommandDoc[],
  scripts: ReadonlySet<string>,
  line: string
) =>
  Effect.map(bunProblems(scripts, line), (missing) => [
    ...programProblem(line),
    ...missing,
    ...cliProblem(docs, line),
  ]);

/** One row of the shot list's table. */
interface Shot {
  readonly beat: string;
  readonly fallback: string;
  readonly id: string;
  readonly preconditions: string;
  readonly run: string;
  readonly screen: string;
}

const SHOT_ROW = /^\| S\d{2} \|/u;

/** The shot list's rows: `| S01 | beat | screen | run | preconditions | fallback |`. */
const shotsOf = (list: string) =>
  list
    .split("\n")
    .filter((line) => SHOT_ROW.test(line))
    .map((line) => {
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());

      return {
        cells: cells.length,
        shot: {
          beat: cells[1] ?? "",
          fallback: cells[5] ?? "",
          id: cells[0] ?? "",
          preconditions: cells[4] ?? "",
          run: cells[3] ?? "",
          screen: cells[2] ?? "",
        } satisfies Shot,
      };
    });

/** The inline code spans of a table cell. */
const spansIn = (cell: string) =>
  [...cell.matchAll(/`(?<code>[^`]+)`/gu)].map(
    (match) => match.groups?.code ?? ""
  );

/** The rehearsal's per-shot checkboxes, by shot id, ticked or not. */
const checkboxIds = (rehearsal: string) =>
  rehearsal
    .split("\n")
    .flatMap(
      (line) => /^- \[[ x]\] (?<id>S\d{2})\b/u.exec(line)?.groups?.id ?? []
    )
    .toSorted();

/** The demo stage's two origins, from the account's workers.dev subdomain. */
const demoOrigins = Effect.gen(function* () {
  const text = yield* presentText(subdomainFile);

  const { subdomain } = yield* Schema.decodeEffect(
    Schema.fromJsonString(WorkersDev)
  )(blankJsonc(text));

  return [platformOrigin("demo", subdomain), webOrigin("demo", subdomain)];
});

const live = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
) => effect.pipe(Effect.provide(NodeServices.layer));

describe("the demo folder", () => {
  it.live(
    "holds the script, the shot list, the swarm scenario and the rehearsal",
    () =>
      live(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* repoRoot;
          const present: Record<string, boolean> = {};

          for (const file of DEMO_FILES) {
            present[file] = yield* fs.exists(path.join(root, DEMO, file));
          }

          expect(present).toStrictEqual({
            "rehearsal.md": true,
            "script.md": true,
            "shot-list.md": true,
            "swarm-scenario.md": true,
          });
        })
      )
  );

  it.live(
    "times the script's seven beats back to back from 0:00 to at most 10:00",
    () =>
      live(
        Effect.gen(function* () {
          const script = yield* presentText(`${DEMO}/script.md`);
          const { beats, unranged } = beatsOf(script);

          expect(unranged, "every H2 is a beat with its range").toStrictEqual(
            []
          );
          expect(beats).toHaveLength(7);
          expect(clockBreaks(beats)).toStrictEqual([]);
          expect(beats.at(-1)?.to ?? Infinity).toBeLessThanOrEqual(600);
        })
      )
  );

  it.live(
    "runs only Bun, git, cd, export, the CLI or a harness in its sh blocks",
    () =>
      live(
        Effect.gen(function* () {
          const files = yield* demoMarkdown;
          const lines: string[] = [];

          for (const file of files) {
            lines.push(...shLines(yield* presentText(file)));
          }

          expect(lines.length, "the demo files show commands").toBeGreaterThan(
            0
          );
          expect(lines.flatMap(programProblem)).toStrictEqual([]);
        })
      )
  );

  it.live(
    "names only root scripts, files that exist and commands the CLI has",
    () =>
      live(
        Effect.gen(function* () {
          const files = yield* demoMarkdown;
          const scripts = yield* rootScripts;
          const docs = commandDocs(Contracts);
          const problems: string[] = [];

          for (const file of files) {
            for (const line of shLines(yield* presentText(file))) {
              problems.push(
                ...(yield* bunProblems(scripts, line)),
                ...cliProblem(docs, line)
              );
            }
          }

          expect(problems).toStrictEqual([]);
        })
      )
  );

  it.live(
    "lists each shot with a script beat, a screen, and commands or URLs on demo",
    () =>
      live(
        Effect.gen(function* () {
          const { beats } = beatsOf(yield* presentText(`${DEMO}/script.md`));
          const titles = new Set(beats.map((beat) => beat.title));
          const rows = shotsOf(yield* presentText(`${DEMO}/shot-list.md`));
          const scripts = yield* rootScripts;
          const docs = commandDocs(Contracts);
          const origins = yield* demoOrigins;
          const problems: string[] = [];

          expect(rows.length, "the shot list has shots").toBeGreaterThan(0);

          for (const { cells, shot } of rows) {
            if (cells !== 6) {
              problems.push(`${shot.id}: ${cells} cells, not 6`);
            }

            if (!titles.has(shot.beat)) {
              problems.push(`${shot.id}: no beat named ${shot.beat}`);
            }

            if (!["split", "terminal", "web"].includes(shot.screen)) {
              problems.push(`${shot.id}: screen ${shot.screen}`);
            }

            if (shot.preconditions === "" || shot.fallback === "") {
              problems.push(`${shot.id}: no preconditions or no fallback`);
            }

            const spans = spansIn(shot.run);

            if (spans.length === 0) {
              problems.push(`${shot.id}: nothing to run or open`);
            }

            for (const span of spans) {
              if (span.startsWith("https://")) {
                if (!origins.some((origin) => span.startsWith(`${origin}/`))) {
                  problems.push(`${shot.id}: ${span} is not on the demo stage`);
                }
              } else {
                problems.push(
                  ...(yield* commandProblems(docs, scripts, span)).map(
                    (problem) => `${shot.id}: ${problem}`
                  )
                );
              }

              for (const { groups } of span.matchAll(
                /--stage (?<stage>\S+)/gu
              )) {
                if (groups?.stage !== "demo") {
                  problems.push(`${shot.id}: --stage ${groups?.stage ?? ""}`);
                }
              }
            }

            if (shot.run.includes("<stage>")) {
              problems.push(`${shot.id}: <stage> is not set`);
            }
          }

          expect(problems).toStrictEqual([]);
        })
      )
  );

  it.live("rehearses every shot once, by its id", () =>
    live(
      Effect.gen(function* () {
        const shots = shotsOf(yield* presentText(`${DEMO}/shot-list.md`))
          .map(({ shot }) => shot.id)
          .toSorted();

        const rehearsal = yield* presentText(`${DEMO}/rehearsal.md`);

        expect(shots.length, "the shot list has shots").toBeGreaterThan(0);
        expect(checkboxIds(rehearsal)).toStrictEqual(shots);
      })
    )
  );
});
