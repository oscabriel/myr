/**
 * The dev world's two fictional projects, as files: each one's first push,
 * the files a decider opens each ask with (its ask file, and its check when
 * the check is a file), and the commits its people push. The projects and
 * their people are invented; any likeness to a real one is not meant.
 *
 * `datekit` is a small date library (the people of
 * `examples/datekit`): `ines-v` decides everything, `okonkwo` the time zones, and
 * `bram` is a vouched contributor. `burrow` is a six-package monorepo with
 * a legacy helper to migrate away from and a lint count to ratchet down
 * (`examples/burrow`), decided by `okafor` and `lin-h`. These are
 * cut-down copies: just enough for every page of the web to have something
 * real to show.
 *
 * A project's rules are its committed `policy.json`, the config folder the
 * `/json` rules evaluator reads, with every ask it will open stated there;
 * an ask opens when a decider lands its files. Each ask file is written
 * from the ask `policy.json` states, as the SDK call a maintainer writes,
 * so the two never disagree. datekit's `policy.json` also states the ask
 * the dev world's drafter drafts, which only an accepted draft opens.
 */
import { Brand } from "@repo/brand";
import { cannedDraft } from "@repo/drafting/draft-runs/canned";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import { Command, SymbolName } from "@repo/protocol/domain/common";
import type { AskKind } from "@repo/protocol/domain/kind";
import { PolicyInput } from "@repo/protocol/domain/policy";
import { AskId, Handle, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Array, Number, Predicate, Schema } from "effect";

import type { Files } from "./git.ts";

const dir = Brand.configDir;

const encodeCheck = Schema.encodeSync(CheckSpec);

const decodeCheck = Schema.decodeSync(CheckSpec);

const encodeMeasure = Schema.encodeSync(RatchetMeasure);

/** What a project's `policy.json` states, as the file holds it. */
export type Stated = typeof PolicyInput.Encoded;

/** One ask as `policy.json` states it. */
export type StatedAsk = Stated["asks"][number];

/** A `policy.json` from what its project states, with every default written out. */
export const policyJson = (stated: Stated) =>
  `${JSON.stringify(
    Schema.encodeSync(PolicyInput)(Schema.decodeSync(PolicyInput)(stated)),
    null,
    2
  )}\n`;

/** One file an ask opens with. */
export interface AskFile {
  readonly content: string;
  readonly path: RepoPath;
}

/** The files a decider opens one ask with: its ask file, then its check's file if it has one. */
export type Opening = Array.NonEmptyReadonlyArray<AskFile>;

/** The args a kind takes for an ask's check, as its ask file passes them (`packages/sdk`'s `kinds`). */
interface KindArgs {
  readonly command?: string;
  readonly count?: string;
  readonly from?: string;
  readonly path?: string;
  readonly ratchet?: string;
  readonly rule?: string;
  readonly to?: string | undefined;
}

/** A string, or a list of them, as TypeScript source spells it. */
const spelled = (value: string | readonly string[]): string =>
  Predicate.isString(value)
    ? JSON.stringify(value)
    : `[${value.map(spelled).join(", ")}]`;

/**
 * The args an ask's kind takes for its check, as the ask file spells them.
 * No SDK call states a `SymbolAbsent` check (a migrate's split opens its
 * delete step), so that file spells the nearest one: a migrate
 * with no `to`, every use gone.
 */
const checkArgs = (check: StatedAsk["check"]) =>
  CheckSpec.match(decodeCheck(check), {
    LintToZero: ({ command, rule }): KindArgs => ({ command, rule }),
    Migrate: ({ count, from, to }): KindArgs => ({ count, from, to }),
    Ratchet: ({ ratchet }): KindArgs => ({ ratchet }),
    RedThenGreen: ({ path }): KindArgs => ({ path }),
    SymbolAbsent: ({ count, symbol }): KindArgs => ({ count, from: symbol }),
  });

/** An ask's territory as its file spells it: the repo-wide builder for `.`, else the data itself. */
const territoryOf = ({ module, paths }: StatedAsk["territory"]) =>
  module === "."
    ? `territory.paths(${paths.map(spelled).join(", ")})`
    : `{ module: ${spelled(module)}, paths: ${spelled(paths)} }`;

/** An ask's file: the SDK call that states `stated`, as its maintainer writes it. */
export const askFileOf = (stated: StatedAsk): AskFile => {
  const territory = territoryOf(stated.territory);

  const passed = Object.entries({
    ...checkArgs(stated.check),
    blockedBy: Array.isReadonlyArrayNonEmpty(stated.blockedBy)
      ? stated.blockedBy
      : undefined,
    current: stated.brief.current,
    mentor: stated.mentor,
    parent: stated.parent,
    reserve: stated.reserve,
    want: stated.brief.want,
  }).flatMap(([key, value]) =>
    value === undefined ? [] : [`${key}: ${spelled(value)}`]
  );

  const args = [...passed, `territory: ${territory}`].toSorted();

  const builders = territory.startsWith("territory.")
    ? "kinds, territory"
    : "kinds";

  return {
    content: [
      `import { ${builders} } from "${Brand.cliPackage}/rules";`,
      "",
      `export default kinds.${stated.kind}.ask({`,
      ...args.map((arg) => `  ${arg},`),
      "});",
      "",
    ].join("\n"),
    path: RepoPath.make(stated.file),
  };
};

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

/** One datekit ask: as `policy.json` states it, and the check file it opens with. */
interface DatekitAsk {
  readonly stated: StatedAsk;
  readonly test: AskFile;
}

/**
 * One datekit ask, from its id, the module file it fixes, its brief and its
 * check's one test (red on main, by an assertion). One held for a newcomer
 * names the maintainer who mentors them. datekit is one package, so every
 * territory is in the repo-wide module, `.`.
 */
const datekitAsk = (input: {
  readonly id: string;
  readonly file: string;
  readonly current: string;
  readonly want: string;
  readonly mentor?: Handle;
  readonly test: {
    readonly imports: readonly string[];
    readonly name: string;
    readonly assertion: string;
  };
}): DatekitAsk => {
  const path = RepoPath.make(`test/asks/${input.id}.test.ts`);

  const stated: StatedAsk = {
    askedBy: datekitPeople.decider,
    blockedBy: [],
    brief: { current: input.current, want: input.want },
    check: encodeCheck(CheckSpec.cases.RedThenGreen.make({ path })),
    file: `${dir}/asks/${input.id}.ask.ts`,
    id: input.id,
    kind: "fix",
    territory: { module: ".", paths: [`src/${input.file}.ts`] },
  };

  return {
    stated:
      input.mentor === undefined
        ? stated
        : { ...stated, mentor: input.mentor, reserve: "newcomers" },
    test: {
      content: [
        'import { expect, test } from "bun:test";',
        "",
        ...input.test.imports,
        "",
        `test(${spelled(input.test.name)}, () => {`,
        `  ${input.test.assertion}`,
        "});",
        "",
      ].join("\n"),
      path,
    },
  };
};

const datekitAsks: readonly DatekitAsk[] = [
  datekitAsk({
    current: "parseISO returns an invalid date for a week date.",
    file: "parse",
    id: "parse-iso-week",
    test: {
      assertion:
        'expect(parseISO("2026-W41-3").toISOString()).toBe("2026-10-07T00:00:00.000Z");',
      imports: ['import { parseISO } from "../../src/parse.ts";'],
      name: "parses an ISO week date",
    },
    want: "parseISO accepts ISO week dates such as 2026-W41-3.",
  }),
  datekitAsk({
    current: 'format prints "11st", "12nd" and "13rd".',
    file: "format",
    id: "format-ordinal",
    // Held for a newcomer, whom its asker mentors.
    mentor: datekitPeople.decider,
    test: {
      assertion: 'expect(format(parseISO("2026-10-11"), "Do")).toBe("11th");',
      imports: [
        'import { format } from "../../src/format.ts";',
        'import { parseISO } from "../../src/parse.ts";',
      ],
      name: "prints the teens as th",
    },
    want: 'format(date, "Do") prints 1st, 2nd, 3rd, 11th, 12th, 13th and 21st.',
  }),
  datekitAsk({
    current: "addMonths(January 31, 1) overflows into March.",
    file: "add",
    id: "add-months-clamp",
    test: {
      assertion:
        'expect(addMonths(parseISO("2026-01-31"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");',
      imports: [
        'import { addMonths } from "../../src/add.ts";',
        'import { parseISO } from "../../src/parse.ts";',
      ],
      name: "clamps to the end of February",
    },
    want: "addMonths(January 31, 1) is the last day of February, in leap and common years.",
  }),
  datekitAsk({
    current: "diffInDays counts a day short across the spring change.",
    file: "diff",
    id: "diff-in-days-dst",
    test: {
      assertion:
        'expect(diffInDays(new Date("2026-03-30T00:00:00+02:00"), new Date("2026-03-29T00:00:00+01:00"))).toBe(1);',
      imports: ['import { diffInDays } from "../../src/diff.ts";'],
      name: "counts the spring change as one day",
    },
    want: "diffInDays counts calendar days across a daylight-saving change.",
  }),
];

/**
 * The ask the dev world's drafter drafts for any want (`cannedDraft`),
 * stated beside datekit's own so the `/json` rules evaluator finds it once
 * a draft's files are composed; nobody opens it in the seed. A decider who
 * accepts the draft opens it.
 */
const draftedAsk: StatedAsk = {
  askedBy: datekitPeople.decider,
  blockedBy: [],
  brief: { current: cannedDraft.current, want: cannedDraft.want },
  check: encodeCheck(
    CheckSpec.cases.RedThenGreen.make({ path: cannedDraft.test.path })
  ),
  file: `${dir}/asks/${cannedDraft.id}.ask.ts`,
  id: cannedDraft.id,
  kind: cannedDraft.kind,
  territory: { module: ".", paths: [...cannedDraft.territory] },
};

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
      asks: [...datekitAsks.map(({ stated }) => stated), draftedAsk],
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
  asks: datekitAsks.map(
    ({ stated, test }) =>
      [AskId.make(stated.id), [askFileOf(stated), test]] as const
  ),
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

/**
 * The one ask burrow's decider opens: the migrate. Its callers sit in all
 * six packages, so the platform opens it as a family: a child
 * per package and a delete child waiting on the six, their files written
 * beside the parent's in the same landing.
 */
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

export const burrow = {
  asks: burrowAsks.map(
    (stated) => [AskId.make(stated.id), [askFileOf(stated)]] as const
  ),
  files: monorepo,
  project: ProjectName.make("burrow"),
} as const;

/** How many times `text` calls `symbol`, as burrow's `scripts/count-callers.ts` counts. */
const callsIn = (text: string, symbol: string) =>
  text.split(`${symbol}(`).length - 1;

/** What burrow's count command prints on its first commit: each package's calls of `legacyFetch`. */
const burrowCallers = () => {
  const byModule = Object.fromEntries(
    PACKAGES.map((pkg) => [
      `@burrow/${pkg}`,
      Number.sumAll(
        [...monorepo].flatMap(([path, text]) =>
          path.startsWith(`packages/${pkg}/src/`)
            ? [callsIn(text, "legacyFetch")]
            : []
        )
      ),
    ])
  );

  return JSON.stringify({
    byModule,
    total: Number.sumAll(Object.values(byModule)),
  });
};

/**
 * What each count command of the examples prints, by the command: the dev
 * Checker runs none, so a count lane prints this wherever it runs.
 */
export const printedBy: ReadonlyMap<string, string> = new Map([
  [COUNT, burrowCallers()],
]);
