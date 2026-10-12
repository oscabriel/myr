import { Brand } from "@repo/brand";
import type { RunBlockEncoded } from "@repo/checks/finder";
import { PATH_PLACEHOLDER } from "@repo/checks/kinds";

type Value = string | readonly string[];

const KEYS = ["setup", "test", "doctor", "image", "setupEgress"] as const;

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
    "export default project({",
    "  run: run.fromCI,",
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
