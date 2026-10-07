/**
 * The config folder's `project.ts` that `init` proposes: the run block the
 * finder read from the repo's own files, each command with where it was
 * found, and nothing else, so every other setting takes its default. Pure:
 * the same commands always give the same text.
 */
import { Brand } from "@repo/brand";
import type { RunBlockEncoded } from "@repo/checks/finder";
import { PATH_PLACEHOLDER } from "@repo/checks/kinds";

/** A value in the run block: a command, or `setupEgress`'s hosts. */
type Value = string | readonly string[];

/** The run block's keys in the order the file writes them; `checks` last. */
const KEYS = ["setup", "test", "doctor", "image", "setupEgress"] as const;

/** A key as TypeScript writes it: bare when it is an identifier. */
const keyOf = (name: string) =>
  /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);

/** Text as one line of a `//` comment, whatever it holds. */
const oneLine = (text: string) => text.replaceAll(/\s+/gu, " ").trim();

const comment = (indent: string, text: string) =>
  `${indent}// ${oneLine(text)}`;

/**
 * The finder's sources for one part of the run block: `setup from <path>`,
 * `setup inferred from <path>`, `checks.lint from <path>`.
 */
const sourcesOf = (sources: readonly string[], part: string) =>
  sources.filter(
    (source) =>
      source.startsWith(`${part} from `) ||
      source.startsWith(`${part} inferred from `)
  );

/** The parts the run block holds, each with its value, in the file's order. */
const partsOf = (run: Partial<RunBlockEncoded>) => [
  ...KEYS.flatMap((key) =>
    run[key] === undefined ? [] : [{ part: key, value: run[key] }]
  ),
  ...Object.entries(run.checks ?? {}).map(([lane, command]) => ({
    part: `checks.${lane}`,
    value: command,
  })),
];

/** Every source no written part names: what the finder skipped, and why. */
const others = (
  sources: readonly string[],
  parts: readonly { readonly part: string }[]
) =>
  sources.filter(
    (source) => !parts.some(({ part }) => sourcesOf([source], part).length > 0)
  );

const rules = (names: string) =>
  `import { ${names} } from "${Brand.cliPackage}/rules";`;

/** A run block written out: each command under the comments naming its sources. */
const explicit = (
  run: Partial<RunBlockEncoded>,
  sources: readonly string[]
) => {
  const entry = (indent: string, part: string, key: string, value: Value) => [
    ...sourcesOf(sources, part).map((source) => comment(indent, source)),
    `${indent}${keyOf(key)}: ${JSON.stringify(value)},`,
  ];

  const lanes = Object.entries(run.checks ?? {}).flatMap(([lane, command]) =>
    entry("      ", `checks.${lane}`, lane, command)
  );

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
    "});",
    "",
  ];
};

/**
 * No command that runs one test file: the file can't state a run block the
 * SDK accepts, so it keeps the platform's own finder, and lists in comments
 * what this one found.
 */
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
    "export default project({",
    "  run: run.fromCI,",
    "});",
    "",
  ];
};

/**
 * The proposed `<configDir>/project.ts` for a run block the finder found
 * and its sources (`findRunBlock` from `@repo/checks/finder`). It imports
 * the SDK from the published CLI's `/rules`, as a maintainer's repo does.
 */
export const projectFile = (
  run: Partial<RunBlockEncoded>,
  sources: readonly string[]
): string =>
  (run.test?.includes(PATH_PLACEHOLDER) === true
    ? explicit(run, sources)
    : fromCI(run, sources)
  ).join("\n");
