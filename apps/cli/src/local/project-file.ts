import { Brand } from "@repo/brand";
import type { RunBlockEncoded } from "@repo/checks/finder";
import { PATH_PLACEHOLDER } from "@repo/checks/kinds";

type Value = string | readonly string[];

const KEYS = ["setup", "test", "doctor", "image", "setupEgress"] as const;

/** Where `init` suggests an ask's failing test goes, so the unit lane can leave it out. */
export const ASKS_DIR = "test/asks";

const ASKS_GLOB = `${ASKS_DIR}/**`;

const keyOf = (name: string) =>
  /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);

const oneLine = (text: string) => text.replaceAll(/\s+/gu, " ").trim();

const comment = (indent: string, text: string) =>
  `${indent}// ${oneLine(text)}`;

const sourcesOf = (sources: readonly string[], part: string) =>
  sources.filter(
    (source) =>
      source.startsWith(`${part} from `) ||
      source.startsWith(`${part} inferred from `)
  );

const partsOf = (run: Partial<RunBlockEncoded>) => [
  ...KEYS.flatMap((key) =>
    run[key] === undefined ? [] : [{ part: key, value: run[key] }]
  ),
  ...Object.entries(run.checks ?? {}).map(([lane, command]) => ({
    part: `checks.${lane}`,
    value: command,
  })),
];

const others = (
  sources: readonly string[],
  parts: readonly { readonly part: string }[]
) =>
  sources.filter(
    (source) => !parts.some(({ part }) => sourcesOf([source], part).length > 0)
  );

const rules = (names: string) =>
  `import { ${names} } from "${Brand.cliPackage}/rules";`;

// Runners whose flag leaves a folder out, by the word that starts the test
// command (after any package runner).
const RUNNER =
  /^(?:(?:npx|bunx|pnpm|pnpm exec|yarn|yarn exec) )?(?<tool>bun test|vitest|jest|mocha|pytest)\b/u;

const SKIPS = new Map([
  ["bun test", `--path-ignore-patterns='${ASKS_GLOB}'`],
  ["jest", `--testPathIgnorePatterns '${ASKS_DIR}/'`],
  ["mocha", `--ignore '${ASKS_GLOB}'`],
  ["pytest", `--ignore=${ASKS_DIR}`],
  ["vitest", `--exclude '${ASKS_GLOB}'`],
]);

const toolOf = (command: string) => RUNNER.exec(command)?.groups?.tool;

const ASKS_TRAP = [
  "An open ask's test fails on main until it is answered, so the suite",
  "every answer must keep green leaves the asks' tests to their own lane.",
] as const;

const ASKS_UNKNOWN = [
  "An open ask's test fails on main until it is answered, so the suite",
  "every answer must keep green must leave the asks' tests out: give this",
  `lane the runner's flag that skips ${ASKS_GLOB}, or every answer's unit`,
  "lane is red while another ask is open.",
] as const;

/**
 * The unit lane with the asks' tests left out, as the runner spells it: the
 * lane's own command when it calls the runner, else the test command without
 * its placeholder, which is what the lane's package script runs.
 */
const unitLane = (unit: string, test: string | undefined) => {
  const runner = test?.replace(` ${PATH_PLACEHOLDER}`, "").trim();
  const own = toolOf(unit);
  const tool = own ?? (runner === undefined ? undefined : toolOf(runner));
  const skip = tool === undefined ? undefined : SKIPS.get(tool);

  return skip === undefined
    ? { command: unit, note: ASKS_UNKNOWN }
    : {
        command: `${own === undefined ? runner : unit} ${skip}`,
        note: ASKS_TRAP,
      };
};

const VOUCH = [
  'Anyone not denounced in vouched.td may claim an ask; "forCode" admits',
  "only the people vouched for there, which a maintainer lands with vouch.",
] as const;

const vouchLines = [
  ...VOUCH.map((line) => `  // ${line}`),
  '  vouch: "bansOnly",',
];

const explicit = (
  run: Partial<RunBlockEncoded>,
  sources: readonly string[]
) => {
  const entry = (indent: string, part: string, key: string, value: Value) => [
    ...sourcesOf(sources, part).map((source) => comment(indent, source)),
    `${indent}${keyOf(key)}: ${JSON.stringify(value)},`,
  ];

  const lanes = Object.entries(run.checks ?? {}).flatMap(([lane, command]) => {
    if (lane !== "unit") {
      return entry("      ", `checks.${lane}`, lane, command);
    }

    const { command: excluded, note } = unitLane(command, run.test);

    return [
      ...sourcesOf(sources, `checks.${lane}`).map((source) =>
        comment("      ", source)
      ),
      ...note.map((line) => `      // ${line}`),
      `      ${keyOf(lane)}: ${JSON.stringify(excluded)},`,
    ];
  });

  return [
    rules("project"),
    "",
    comment(
      "",
      `The run block \`${Brand.cli} init\` found in this repo's own files, each`
    ),
    comment(
      "",
      "command with where it was found. Every other setting takes its default."
    ),
    ...others(sources, partsOf(run)).map((source) => comment("", source)),
    "export default project({",
    "  run: {",
    ...KEYS.flatMap((key) =>
      run[key] === undefined ? [] : entry("    ", key, key, run[key])
    ),
    ...(lanes.length === 0
      ? ["    checks: {},"]
      : ["    checks: {", ...lanes, "    },"]),
    "  },",
    ...vouchLines,
    "});",
    "",
  ];
};

/** With no command that runs one test file, the SDK accepts no run block, so the file keeps the platform's finder. */
const fromCI = (run: Partial<RunBlockEncoded>, sources: readonly string[]) => {
  const parts = partsOf(run);

  return [
    rules("project, run"),
    "",
    comment(
      "",
      `\`${Brand.cli} init\` found no command that runs one test file (${PATH_PLACEHOLDER}), so`
    ),
    comment(
      "",
      `the platform reads the run block from CI at each landing.${parts.length > 0 ? " It found:" : ""}`
    ),
    ...parts.map(
      ({ part, value }) =>
        `//   ${part}: ${oneLine(JSON.stringify(value))} (${oneLine(sourcesOf(sources, part).join("; "))})`
    ),
    ...others(sources, parts).map((source) => comment("", source)),
    comment(
      "",
      `A red-first ask needs a test command with ${PATH_PLACEHOLDER}; once one is here, give the unit`
    ),
    comment(
      "",
      `lane the runner's flag that skips ${ASKS_GLOB}, or every answer's unit lane is red while another ask is open.`
    ),
    "export default project({",
    "  run: run.fromCI,",
    ...vouchLines,
    "});",
    "",
  ];
};

export const projectFile = (
  run: Partial<RunBlockEncoded>,
  sources: readonly string[]
): string =>
  (run.test?.includes(PATH_PLACEHOLDER) === true
    ? explicit(run, sources)
    : fromCI(run, sources)
  ).join("\n");
