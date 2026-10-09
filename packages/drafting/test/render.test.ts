/**
 * The ask file is written by code from the drafted fields: rendered, then
 * evaluated by the rules' `/bun` adapter beside datekit's own config folder,
 * it states the same ask as the hand-written file, and every string the
 * model gave stays data.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { FinishersFromChecks } from "@repo/project/project";
import { Policy } from "@repo/protocol/domain/policy";
import { AskId, LandedSha, RepoPath } from "@repo/protocol/ids";
import { EvaluationFacts, RulesEvaluator } from "@repo/rules/rules-evaluator";
import type { ConfigBundle } from "@repo/rules/rules-evaluator";
import { RulesEvaluatorBun } from "@repo/rules/rules-evaluator/bun";
import { Array, Effect, FileSystem, Layer, Path, Schema, Struct } from "effect";

import type { DraftedAsk } from "../src/drafted.ts";
import { draftedFiles, renderAskFile } from "../src/render.ts";

const exampleUrl = new URL("../../../examples/datekit/", import.meta.url);

const at = LandedSha.make("a".repeat(40));

const askFile = (id: string) => `${Brand.configDir}/asks/${id}.ask.ts`;

/** datekit's config folder, as the Lander bundles it, keyed by repo path. */
const datekitModules = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(exampleUrl);
  const dir = path.join(root, Brand.configDir);
  const modules: Record<string, string> = {};

  for (const file of (yield* fs.readDirectory(dir, {
    recursive: true,
  })).toSorted()) {
    const full = path.join(dir, file);

    if ((yield* fs.stat(full)).type === "File") {
      modules[`${Brand.configDir}/${file}`] = yield* fs.readFileString(full);
    }
  }

  return modules;
});

/** The asks a bundle of datekit's folder evaluates to, encoded, by id. */
const asksOf = (modules: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;

    const facts = yield* Schema.decodeEffect(EvaluationFacts)({
      ci: [],
      initializer: "ines-v",
      now: "2026-10-07T12:00:00.000Z",
      project: "datekit",
      seed: 7,
      workspaces: [],
    });

    const bundle: ConfigBundle = {
      entry: `${Brand.configDir}/project.ts`,
      modules,
      sdkVersion: "0.0.0",
    };

    const policy = yield* Schema.encodeEffect(Policy)(
      yield* evaluator.evaluate({ at, facts, modules: bundle })
    );

    return new Map(policy.asks.map((ask) => [ask.id, ask]));
  });

const evaluator = RulesEvaluatorBun.pipe(
  Layer.provide(Layer.mergeAll(FinishersFromChecks, NodeServices.layer)),
  Layer.provideMerge(NodeServices.layer)
);

/** A template literal's hole, as text: `$` then `{x}`. */
const hole = ["$", "{x}"].join("");

const globalHole = ["$", "{globalThis.x}"].join("");

const test = (id: string) => ({
  path: RepoPath.make(`test/asks/${id}.test.ts`),
  source: 'import { expect, it } from "bun:test";\n',
});

/** `format-ordinal.ask.ts`'s fields, as a drafter would give them. */
const formatOrdinal: DraftedAsk = {
  current: "The 11th, 12th and 13th of a month print as 11st, 12nd and 13rd.",
  id: AskId.make("format-ordinal"),
  kind: "fix",
  outOfScope: [
    "Ordinals in languages other than English",
    "Any token other than Do",
  ],
  rationale: "The ordinal suffix ignores the teens.",
  territory: [
    RepoPath.make("src/format.ts"),
    RepoPath.make("test/format.test.ts"),
  ],
  test: test("format-ordinal"),
  want: "The Do token of format prints the day of the month as an English ordinal: 1st, 2nd, 3rd and 4th, 11th, 12th and 13th, then 21st, 22nd, 23rd and 31st.",
};

/** `add-months-clamp.ask.ts`'s fields: every brief field a draft may give. */
const addMonthsClamp: DraftedAsk = {
  context: [
    "addYears adds twelve months, so it follows: February 29 plus a year becomes February 28.",
  ],
  current:
    "addMonths runs over into the next month: January 31 plus one month is March 2 in a leap year and March 3 otherwise.",
  id: AskId.make("add-months-clamp"),
  kind: "fix",
  outOfScope: [
    "addDays and addWeeks, which count exact days",
    "diffInCalendarMonths",
  ],
  rationale: "Month arithmetic overflows short months.",
  territory: [RepoPath.make("src/add.ts"), RepoPath.make("test/add.test.ts")],
  test: test("add-months-clamp"),
  want: "addMonths ends on the last day of the target month when that month is too short for the start date's day, in either direction: January 31 plus one month is February 29 in a leap year and February 28 otherwise. The time of day is kept.",
};

describe("the rendered ask file", () => {
  it.live(
    "states the same ask as datekit's hand-written files, for the same fields",
    () =>
      Effect.gen(function* () {
        const modules = yield* datekitModules;
        const written = yield* asksOf(modules);

        const rendered = yield* asksOf({
          ...modules,
          [askFile("add-months-clamp")]: renderAskFile(addMonthsClamp),
          [askFile("format-ordinal")]: renderAskFile(formatOrdinal),
        });

        expect(rendered.get("add-months-clamp")).toStrictEqual(
          written.get("add-months-clamp")
        );

        // A draft never names a mentor or a reserve: a decider sets those.
        const ordinal = written.get("format-ordinal");

        expect(ordinal?.mentor).toBe("okonkwo");
        expect(rendered.get("format-ordinal")).toStrictEqual(
          ordinal === undefined
            ? undefined
            : Struct.omit(ordinal, ["mentor", "reserve"])
        );
      }).pipe(Effect.provide(evaluator)),
    60_000
  );

  it.live(
    "keeps quotes, backticks and template holes in a want as data",
    () =>
      Effect.gen(function* () {
        const modules = yield* datekitModules;

        const want = `format("${hole}") prints \`${hole}\` and "quoted" text\\n, then ends; }); process.exit(1); ({`;

        const asks = yield* asksOf({
          ...modules,
          [askFile("add-months-clamp")]: renderAskFile({
            ...addMonthsClamp,
            context: ["a `tick`", globalHole],
            want,
          }),
        });

        expect(asks.get("add-months-clamp")?.brief).toStrictEqual({
          context: ["a `tick`", globalHole],
          current: addMonthsClamp.current,
          outOfScope: addMonthsClamp.outOfScope,
          want,
        });
      }).pipe(Effect.provide(evaluator)),
    60_000
  );

  it("imports the rules by the CLI package's name, keys sorted, nothing the model left out", () => {
    const source = renderAskFile({
      id: AskId.make("iso-week"),
      kind: "fix",
      outOfScope: [],
      rationale: "none",
      territory: [RepoPath.make("src/parse.ts")],
      test: test("iso-week"),
      want: "Week dates parse.",
    });

    expect(source).toBe(
      [
        `import { kinds, territory } from "${Brand.cliPackage}/rules";`,
        "",
        "export default kinds.fix.ask({",
        '  path: "test/asks/iso-week.test.ts",',
        '  territory: territory.paths("src/parse.ts"),',
        '  want: "Week dates parse.",',
        "});",
        "",
      ].join("\n")
    );
  });

  it("gives the proposal's two files: the ask file, then the model's test", () => {
    const [ask, check] = draftedFiles(formatOrdinal);

    expect(ask).toStrictEqual({
      content: renderAskFile(formatOrdinal),
      path: `${Brand.configDir}/asks/format-ordinal.ask.ts`,
    });
    expect(check).toStrictEqual({
      content: formatOrdinal.test.source,
      path: "test/asks/format-ordinal.test.ts",
    });
    expect(Array.length(draftedFiles(formatOrdinal))).toBe(2);
  });
});
