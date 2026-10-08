/**
 * The dev world's two fictional projects, as files: each one's first push,
 * the files a decider opens each ask with (its ask file, and its check when
 * the check is a file), and the commits its people push. The projects and
 * their people are invented; any likeness to a real one is not meant.
 *
 * `datekit` is a small date library (the people of `examples/datekit`,
 * issue 507): `ines-v` decides everything, `okonkwo` the time zones, and
 * `bram` is a vouched contributor. `burrow` is a six-package monorepo with
 * a legacy helper to migrate away from and a lint count to ratchet down
 * (`examples/burrow`, issue 508), decided by `okafor` and `lin-h`. These are
 * cut-down copies: just enough for every page of the web to have something
 * real to show.
 *
 * A project's rules are its committed `policy.json`, the config folder the
 * `/json` rules evaluator reads, with every ask it will open stated there;
 * an ask opens when a decider lands its files.
 */
import { Brand } from "@repo/brand";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import { Command, SymbolName } from "@repo/protocol/domain/common";
import type { AskKind } from "@repo/protocol/domain/kind";
import { PolicyInput } from "@repo/protocol/domain/policy";
import { AskId, Handle, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Array, Schema } from "effect";

import type { Files } from "./git.ts";

const dir = Brand.configDir;

const encodeCheck = Schema.encodeSync(CheckSpec);

const encodeMeasure = Schema.encodeSync(RatchetMeasure);

/** What a project's `policy.json` states, as the file holds it. */
type Stated = typeof PolicyInput.Encoded;

/** One ask as `policy.json` states it. */
type StatedAsk = Stated["asks"][number];

/** A `policy.json` from what its project states, with every default written out. */
const policyJson = (stated: Stated) =>
  `${JSON.stringify(
    Schema.encodeSync(PolicyInput)(Schema.decodeSync(PolicyInput)(stated)),
    null,
    2
  )}\n`;

/** One file an ask opens with. */
interface AskFile {
  readonly content: string;
  readonly path: RepoPath;
}

/** An ask's file: the SDK call a maintainer writes, for people to read (the evaluator reads `policy.json`). */
const askFile = (input: {
  readonly id: string;
  readonly kind: string;
  readonly want: string;
  readonly check: string;
}): AskFile => ({
  content: [
    `import { check, kinds } from "${Brand.cliPackage}/rules";`,
    "",
    `export default kinds.${input.kind}.ask({`,
    `  want: ${JSON.stringify(input.want)},`,
    `  check: ${input.check},`,
    "});",
    "",
  ].join("\n"),
  path: RepoPath.make(`${dir}/asks/${input.id}.ask.ts`),
});

/** The files a decider opens one ask with: its ask file, then its check's file if it has one. */
export type Opening = Array.NonEmptyReadonlyArray<AskFile>;

// ------------------------------------------------------------- datekit

export const datekitPeople = {
  contributor: Handle.make("bram"),
  decider: Handle.make("ines-v"),
  zones: Handle.make("okonkwo"),
} as const;

const fix = {
  checkKind: "redThenGreen",
  claimers: "vouched",
  finish: "optional",
  name: "fix",
  oneWay: false,
  race: 1,
  requires: ["want", "check", "territory"],
  strength: "assertion",
} satisfies typeof AskKind.Encoded;

/** One datekit ask: its id, file, check and want, in `policy.json`'s terms. */
const datekitAsk = (input: {
  readonly id: string;
  readonly file: string;
  readonly want: string;
  readonly current: string;
}): StatedAsk => ({
  askedBy: datekitPeople.decider,
  blockedBy: [],
  brief: { current: input.current, want: input.want },
  check: encodeCheck(
    CheckSpec.cases.RedThenGreen.make({
      path: RepoPath.make(`test/asks/${input.id}.test.ts`),
    })
  ),
  file: `${dir}/asks/${input.id}.ask.ts`,
  id: input.id,
  kind: "fix",
  territory: { module: "datekit", paths: [`src/${input.file}.ts`] },
});

const datekitAsks: readonly StatedAsk[] = [
  datekitAsk({
    current: "parseISO returns an invalid date for a week date.",
    file: "parse",
    id: "parse-iso-week",
    want: "parseISO accepts ISO week dates such as 2026-W41-3.",
  }),
  // Held for a newcomer, whom its asker mentors.
  {
    ...datekitAsk({
      current: 'format prints "11st", "12nd" and "13rd".',
      file: "format",
      id: "format-ordinal",
      want: 'format(date, "Do") prints 1st, 2nd, 3rd, 11th, 12th, 13th and 21st.',
    }),
    mentor: datekitPeople.decider,
    reserve: "newcomers",
  },
  datekitAsk({
    current: "addMonths(January 31, 1) overflows into March.",
    file: "add",
    id: "add-months-clamp",
    want: "addMonths(January 31, 1) is the last day of February, in leap and common years.",
  }),
  datekitAsk({
    current: "diffInDays counts a day short across the spring change.",
    file: "diff",
    id: "diff-in-days-dst",
    want: "diffInDays counts calendar days across a daylight-saving change.",
  }),
];

const library: Files = new Map([
  [
    "README.md",
    [
      "# datekit",
      "",
      "Small, dependency-free date helpers: parse, format, add and diff.",
      "",
      "A fictional project: it and its people are invented.",
      "",
    ].join("\n"),
  ],
  [
    "package.json",
    `${JSON.stringify(
      {
        license: "MIT",
        name: "datekit",
        scripts: { test: "bun test", typecheck: "tsc --noEmit" },
        type: "module",
        version: "0.4.2",
      },
      null,
      2
    )}\n`,
  ],
  [
    "src/index.ts",
    [
      'export { addMonths } from "./add.ts";',
      'export { diffInDays } from "./diff.ts";',
      'export { format } from "./format.ts";',
      'export { parseISO } from "./parse.ts";',
      'export { inZone } from "./tz.ts";',
      "",
    ].join("\n"),
  ],
  [
    "src/parse.ts",
    [
      "/** An ISO 8601 date (`2026-10-07`) or date-time, read as UTC. */",
      "export const parseISO = (text: string): Date =>",
      '  new Date(text.length === 10 ? text + "T00:00:00Z" : text);',
      "",
    ].join("\n"),
  ],
  [
    "src/format.ts",
    [
      'const pad = (n: number) => String(n).padStart(2, "0");',
      "",
      'const ordinal = (n: number) => String(n) + (["th", "st", "nd", "rd"][n % 10] ?? "th");',
      "",
      "/** `date` in `pattern`: YYYY, MM, DD and Do (the day as an ordinal). */",
      "export const format = (date: Date, pattern: string): string =>",
      "  pattern",
      '    .replaceAll("YYYY", String(date.getUTCFullYear()))',
      '    .replaceAll("MM", pad(date.getUTCMonth() + 1))',
      '    .replaceAll("Do", ordinal(date.getUTCDate()))',
      '    .replaceAll("DD", pad(date.getUTCDate()));',
      "",
    ].join("\n"),
  ],
  [
    "src/add.ts",
    [
      "/** `date` moved by whole months. */",
      "export const addMonths = (date: Date, months: number): Date => {",
      "  const next = new Date(date);",
      "",
      "  next.setUTCMonth(next.getUTCMonth() + months);",
      "",
      "  return next;",
      "};",
      "",
    ].join("\n"),
  ],
  [
    "src/diff.ts",
    [
      "const DAY = 86_400_000;",
      "",
      "/** Whole days from `earlier` to `later`. */",
      "export const diffInDays = (later: Date, earlier: Date): number =>",
      "  Math.floor((later.getTime() - earlier.getTime()) / DAY);",
      "",
    ].join("\n"),
  ],
  [
    "src/tz.ts",
    [
      "/** `date` as wall-clock parts in an IANA time zone. */",
      "export const inZone = (date: Date, zone: string) =>",
      '  new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: zone }).format(date);',
      "",
    ].join("\n"),
  ],
  [
    "test/format.test.ts",
    [
      'import { expect, test } from "bun:test";',
      "",
      'import { format } from "../src/format.ts";',
      'import { parseISO } from "../src/parse.ts";',
      "",
      'test("formats a date", () => {',
      '  expect(format(parseISO("2026-10-07"), "YYYY-MM-DD")).toBe("2026-10-07");',
      "});",
      "",
    ].join("\n"),
  ],
  [
    `${dir}/policy.json`,
    policyJson({
      asks: datekitAsks,
      deciders: [
        { handles: [datekitPeople.decider], paths: "**" },
        { handles: [datekitPeople.zones], paths: "src/tz.ts" },
      ],
      functions: { admit: false, opensAlone: false },
      kinds: [fix],
      ratchets: [],
      run: {
        checks: { types: "bun run typecheck" },
        test: "bun test {path}",
      },
      source: "config",
      weakening: { markers: [".skip(", ".only(", ".todo("] },
    }),
  ],
  [
    `${dir}/vouched.td`,
    [
      "# The people datekit's deciders vouch for.",
      datekitPeople.contributor,
      "",
    ].join("\n"),
  ],
]);

/** A datekit ask's check: red on main, by an assertion. */
const datekitCheck = (
  id: string,
  imports: string,
  name: string,
  assertion: string
): AskFile => ({
  content: [
    'import { expect, test } from "bun:test";',
    "",
    imports,
    "",
    `test(${JSON.stringify(name)}, () => {`,
    `  ${assertion}`,
    "});",
    "",
  ].join("\n"),
  path: RepoPath.make(`test/asks/${id}.test.ts`),
});

const datekitOpening = (id: string, want: string, check: AskFile): Opening => [
  askFile({
    check: `check.redThenGreen(${JSON.stringify(check.path)})`,
    id,
    kind: "fix",
    want,
  }),
  check,
];

export const datekit = {
  answer: {
    ask: AskId.make("diff-in-days-dst"),
    files: new Map([
      [
        "src/diff.ts",
        [
          "const DAY = 86_400_000;",
          "",
          "/** Whole calendar days from `earlier` to `later`, across any daylight-saving change. */",
          "export const diffInDays = (later: Date, earlier: Date): number =>",
          "  Math.round((later.getTime() - earlier.getTime()) / DAY);",
          "",
        ].join("\n"),
      ],
    ]) satisfies Files,
    message: "Count calendar days across a daylight-saving change",
  },
  asks: [
    [
      AskId.make("parse-iso-week"),
      datekitOpening(
        "parse-iso-week",
        "parseISO accepts ISO week dates such as 2026-W41-3.",
        datekitCheck(
          "parse-iso-week",
          'import { parseISO } from "../../src/parse.ts";',
          "parses an ISO week date",
          'expect(parseISO("2026-W41-3").toISOString()).toBe("2026-10-07T00:00:00.000Z");'
        )
      ),
    ],
    [
      AskId.make("format-ordinal"),
      datekitOpening(
        "format-ordinal",
        'format(date, "Do") prints 1st, 2nd, 3rd, 11th, 12th, 13th and 21st.',
        datekitCheck(
          "format-ordinal",
          'import { format } from "../../src/format.ts";\nimport { parseISO } from "../../src/parse.ts";',
          "prints the teens as th",
          'expect(format(parseISO("2026-10-11"), "Do")).toBe("11th");'
        )
      ),
    ],
    [
      AskId.make("add-months-clamp"),
      datekitOpening(
        "add-months-clamp",
        "addMonths(January 31, 1) is the last day of February, in leap and common years.",
        datekitCheck(
          "add-months-clamp",
          'import { addMonths } from "../../src/add.ts";\nimport { parseISO } from "../../src/parse.ts";',
          "clamps to the end of February",
          'expect(addMonths(parseISO("2026-01-31"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");'
        )
      ),
    ],
    [
      AskId.make("diff-in-days-dst"),
      datekitOpening(
        "diff-in-days-dst",
        "diffInDays counts calendar days across a daylight-saving change.",
        datekitCheck(
          "diff-in-days-dst",
          'import { diffInDays } from "../../src/diff.ts";',
          "counts the spring change as one day",
          'expect(diffInDays(new Date("2026-03-30T00:00:00+02:00"), new Date("2026-03-29T00:00:00+01:00"))).toBe(1);'
        )
      ),
    ],
  ] as const,
  files: library,
  project: ProjectName.make("datekit"),
  /** A commit someone pushed straight to main, past the platform. */
  stray: {
    files: new Map([
      [
        "README.md",
        [
          "# datekit",
          "",
          "Small, dependency-free date helpers: parse, format, add, diff and time zones.",
          "",
          "A fictional project: it and its people are invented.",
          "",
        ].join("\n"),
      ],
    ]) satisfies Files,
    message: "Mention time zones in the README",
  },
} as const;

// -------------------------------------------------------------- burrow

export const burrowPeople = {
  decider: Handle.make("okafor"),
  second: Handle.make("lin-h"),
} as const;

const PACKAGES = [
  "kit",
  "auth",
  "billing",
  "catalog",
  "notify",
  "search",
] as const;

const COUNT = "bun scripts/count-callers.ts legacyFetch --json";

const migrateCheck = encodeCheck(
  CheckSpec.cases.Migrate.make({
    count: Command.make(COUNT),
    from: SymbolName.make("legacyFetch"),
    to: SymbolName.make("http.get"),
  })
);

const PARENT = "drop-legacy-fetch";

/** One step of the migrate family: moving one package off `legacyFetch`. */
const child = (pkg: string): StatedAsk => ({
  askedBy: burrowPeople.decider,
  blockedBy: [],
  brief: {
    want: `@burrow/${pkg} calls http.get wherever it called legacyFetch.`,
  },
  check: migrateCheck,
  file: `${dir}/asks/${PARENT}-${pkg}.ask.ts`,
  id: `${PARENT}-${pkg}`,
  kind: "migrate",
  parent: PARENT,
  territory: { module: `@burrow/${pkg}`, paths: [`packages/${pkg}/**`] },
});

const CHILDREN = ["auth", "billing"];

const burrowAsks: readonly StatedAsk[] = [
  {
    askedBy: burrowPeople.decider,
    blockedBy: [],
    brief: {
      want: "Replace every call to legacyFetch with http.get, then delete legacyFetch.",
    },
    check: migrateCheck,
    file: `${dir}/asks/${PARENT}.ask.ts`,
    id: PARENT,
    kind: "migrate",
    territory: {
      module: ".",
      paths: Array.map(PACKAGES, (pkg) => `packages/${pkg}/**`),
    },
  },
  ...CHILDREN.map(child),
  {
    askedBy: burrowPeople.decider,
    blockedBy: CHILDREN.map((pkg) => `${PARENT}-${pkg}`),
    brief: { want: "Delete legacyFetch: nothing calls it any more." },
    check: encodeCheck(
      CheckSpec.cases.SymbolAbsent.make({
        count: Command.make(COUNT),
        symbol: SymbolName.make("legacyFetch"),
      })
    ),
    file: `${dir}/asks/${PARENT}-delete.ask.ts`,
    id: `${PARENT}-delete`,
    kind: "migrate",
    parent: PARENT,
    territory: { module: "@burrow/kit", paths: ["packages/kit/**"] },
  },
];

const packageFiles = (pkg: string): readonly (readonly [string, string])[] => [
  [
    `packages/${pkg}/package.json`,
    `${JSON.stringify(
      {
        exports: { ".": "./src/index.ts" },
        name: `@burrow/${pkg}`,
        type: "module",
      },
      null,
      2
    )}\n`,
  ],
  [
    `packages/${pkg}/src/index.ts`,
    pkg === "kit"
      ? [
          "/** The old way to fetch: kept until nothing calls it. */",
          "export const legacyFetch = (url: string) => fetch(url).then((response) => response.json());",
          "",
          "export const http = { get: (url: string) => fetch(url).then((response) => response.json()) };",
          "",
          "let calls = 0;",
          "",
          'export const ping = () => legacyFetch("/kit/ping?n=" + String((calls += 1)));',
          "",
        ].join("\n")
      : [
          'import { legacyFetch } from "@burrow/kit";',
          "",
          "let cache: unknown;",
          "",
          `export const load = async () => (cache ??= await legacyFetch("/${pkg}"));`,
          "",
        ].join("\n"),
  ],
];

const monorepo: Files = new Map([
  [
    "README.md",
    [
      "# burrow",
      "",
      "Six packages that share a kit, a lint setup and a debt counter.",
      "",
      "A fictional project: it and its people are invented.",
      "",
    ].join("\n"),
  ],
  [
    "package.json",
    `${JSON.stringify(
      {
        name: "burrow",
        private: true,
        scripts: { lint: "oxlint", test: "bun test" },
        workspaces: ["packages/*"],
      },
      null,
      2
    )}\n`,
  ],
  [
    "scripts/count-callers.ts",
    [
      "// Prints how many times each package calls a symbol, as JSON.",
      'import { Glob } from "bun";',
      "",
      "const [symbol] = Bun.argv.slice(2);",
      "const byModule: Record<string, number> = {};",
      "",
      'for await (const path of new Glob("packages/*/src/**/*.ts").scan()) {',
      '  const name = "@burrow/" + path.split("/")[1];',
      "  const text = await Bun.file(path).text();",
      "",
      '  byModule[name] = (byModule[name] ?? 0) + (text.split(symbol + "(").length - 1);',
      "}",
      "",
      "const total = Object.values(byModule).reduce((sum, n) => sum + n, 0);",
      "",
      "console.log(JSON.stringify({ byModule, total }));",
      "",
    ].join("\n"),
  ],
  ...PACKAGES.flatMap(packageFiles),
  [
    `${dir}/policy.json`,
    policyJson({
      asks: burrowAsks,
      deciders: [
        {
          handles: [burrowPeople.decider, burrowPeople.second],
          paths: "**",
        },
      ],
      functions: { admit: false, opensAlone: false },
      kinds: [
        {
          checkKind: "migrate",
          claimers: "vouched",
          finish: "never",
          name: "migrate",
          oneWay: false,
          race: 1,
          requires: ["want", "check", "territory"],
          strength: "assertion",
        },
      ],
      ratchets: [
        {
          measure: encodeMeasure(
            RatchetMeasure.cases.Count.make({
              command: Command.make("bun run lint --format json"),
              rule: "burrow/no-module-level-mutable-state",
            })
          ),
          name: "mutable-state",
        },
      ],
      run: { checks: { lint: "bun run lint" }, test: "bun test {path}" },
      source: "config",
      weakening: { markers: [".skip(", ".only(", ".todo("] },
    }),
  ],
  [`${dir}/vouched.td`, "# The people burrow's deciders vouch for.\n"],
]);

const migrateOpening = (
  id: string,
  want: string,
  check = `check.migrate({ count: ${JSON.stringify(COUNT)}, from: "legacyFetch", to: "http.get" })`
): Opening => [askFile({ check, id, kind: "migrate", want })];

export const burrow = {
  asks: [
    [
      AskId.make(PARENT),
      migrateOpening(
        PARENT,
        "Replace every call to legacyFetch with http.get, then delete legacyFetch."
      ),
    ],
    ...CHILDREN.map(
      (pkg) =>
        [
          AskId.make(`${PARENT}-${pkg}`),
          migrateOpening(
            `${PARENT}-${pkg}`,
            `@burrow/${pkg} calls http.get wherever it called legacyFetch.`
          ),
        ] as const
    ),
    [
      AskId.make(`${PARENT}-delete`),
      migrateOpening(
        `${PARENT}-delete`,
        "Delete legacyFetch: nothing calls it any more.",
        `check.symbolAbsent({ count: ${JSON.stringify(COUNT)}, symbol: "legacyFetch" })`
      ),
    ],
  ] as const,
  files: monorepo,
  project: ProjectName.make("burrow"),
} as const;
