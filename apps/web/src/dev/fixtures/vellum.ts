/**
 * vellum: the fixture project, a six-package library that reads and
 * writes a small document format, with its held-back checks in two areas
 * (export and parser) and a write-only token for its error reports. Its
 * record is told as a story (`story.ts`) from its first asks in September
 * to the morning the world stands at, so each state a page draws is there
 * once, reached the way the service would reach it:
 *
 * - answers: checking, waiting on a decision, waiting for a finish,
 *   waiting on another ask, refused at Shape, at the held-back stage and at
 *   the checks, landed with a decision and held-back results, landed with
 *   neither, and one in its third round;
 * - asks: open, held for newcomers, claimed with and without a push, a
 *   released claim, a lapsed one, and a want too long for a title;
 * - two families: one with a child in every mark and its delete child
 *   waiting, one whose children all landed and whose delete child opened;
 * - a decision of every kind, two taken this morning, one due within the
 *   day; proposals drafting, ready and failed;
 * - a ledger with a layer, two committed areas and history of every kind,
 *   an env shape with a write-only item someone set, and a policy that
 *   names deciders by path and one denounced person.
 *
 * Its people are the examples' own (`examples.ts`, `seed.ts`): `ines-v`
 * decides, `okonkwo` decides the export package, the env schema and the
 * vouch file, `lin-h` decides the config folder with her; `bram`,
 * `okafor` and `lin-h` have answered here for weeks; `tove` and `sefa`
 * are new; `wren` is denounced.
 */
import { Brand } from "@repo/brand";
import { childId, deleteChildId } from "@repo/project/migrate";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import { Command, JsonPath, SymbolName } from "@repo/protocol/domain/common";
import type { Decision, DecisionSubject } from "@repo/protocol/domain/decision";
import { DecisionSubject as Subject } from "@repo/protocol/domain/decision";
import type { EnvSchemaView } from "@repo/protocol/domain/env";
import { Outcome } from "@repo/protocol/domain/outcome";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import { Territory } from "@repo/protocol/domain/territory";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Ledger } from "@repo/protocol/domain/visibility";
import type { Handle, LandedSha } from "@repo/protocol/ids";
import {
  AreaName,
  AskId,
  DecisionId,
  EnvKey,
  KindName,
  LaneName,
  LayerName,
  ProjectName,
  ProposalId,
  RatchetName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  ChecksFailed,
  HeldBackFailed,
  OutOfScope,
  Weakened,
} from "@repo/protocol/refusal";
import { Array, DateTime, Effect, Schema } from "effect";

import { DevClock } from "../clock.ts";
import {
  askFileOf,
  burrowPeople,
  datekitPeople,
  policyJson,
} from "../examples.ts";
import type { StatedAsk } from "../examples.ts";
import type { Files } from "../git.ts";
import { visitors } from "../seed.ts";
import { checkOf } from "./fillers.ts";
import { headOf, instant, present, storyOf, suiteOf } from "./story.ts";
import type { Story } from "./story.ts";

export const vellum = ProjectName.make("oscabriel/vellum");

/** The calendar's instant the world's clock stands at once the fixtures are told. */
export const fixturesNow = instant("2026-10-07T10:00");

/** When vellum's first commit was pushed, by its initializer, on the calendar. */
export const vellumStart = instant("2026-08-24T09:00");

const dir = Brand.configDir;

const people = {
  bram: datekitPeople.contributor,
  ines: datekitPeople.decider,
  lin: burrowPeople.second,
  okafor: burrowPeople.decider,
  okonkwo: datekitPeople.zones,
  sefa: visitors.flagger,
  tove: visitors.proposer,
  wren: visitors.regular,
} as const;

/** vellum's initializer, who decides everything not named for someone else. */
export const vellumInitializer = people.ines;

const MODULES = [
  "cli",
  "export",
  "lint",
  "parser",
  "render",
  "themes",
] as const;

type Module = (typeof MODULES)[number];

const moduleName = (module: Module) => `@vellum/${module}`;

const territoryOf = (module: Module): Territory => ({
  module: moduleName(module),
  paths: [
    Schema.decodeSync(Territory.fields.paths)([`packages/${module}/**`])[0],
  ],
});

const LANES = {
  lint: "bun run lint",
  types: "bun run typecheck",
  unit: "bun test",
} as const;

const TEST = "bun test {path}";

const MAIN_REF = Schema.decodeSync(Subject.cases.StrayPush.fields.ref)(
  "refs/heads/main"
);

const WIDER_HOSTS = Schema.decodeSync(Subject.cases.ProxyWidened.fields.hosts)([
  "sentry.io",
  "ingest.sentry.io",
]);

// The areas whose checks the maintainers hold back, and their commitments.
const EXPORT = AreaName.make("export");

const PARSER = AreaName.make("parser");

const exportSuite = suiteOf("export");

const parserSuite = suiteOf("parser");

const held = (
  area: AreaName,
  passed: number,
  total: number
): HeldBackResult => ({
  area,
  passed,
  suite: area === EXPORT ? exportSuite : parserSuite,
  total,
});

// --------------------------------------------------------------- files

const encodeCheck = Schema.encodeSync(CheckSpec);

const COUNT = Command.make("bun scripts/count-callers.ts oldTokenize --json");

const COUNT_PAGES = Command.make(
  "bun scripts/count-callers.ts pageSize --json"
);

const packageJson = (module: Module) =>
  `${JSON.stringify(
    {
      exports: { ".": "./src/index.ts" },
      name: moduleName(module),
      type: "module",
    },
    null,
    2
  )}\n`;

/** A module's entry, calling the old tokenizer twice. */
const entryOf = (module: Module, tokenize: string) =>
  [
    `import { ${tokenize} } from "@vellum/parser/tokenize";`,
    "",
    `/** ${moduleName(module)}: reads a document's words, then its marks. */`,
    `export const words = (text: string) => ${tokenize}(text).filter((token) => token.kind === "word");`,
    "",
    `export const marks = (text: string) => ${tokenize}(text).filter((token) => token.kind === "mark");`,
    "",
  ].join("\n");

/** A module's page settings, under the old name or the new. */
const pageOf = (module: Module, name: string) =>
  [
    `/** ${moduleName(module)}'s page: A4 unless a theme says otherwise. */`,
    `export const ${name} = { height: 297, width: 210 } as const;`,
    "",
  ].join("\n");

const PAGED: readonly Module[] = ["cli", "render", "themes"];

const ENV_SCHEMA = [
  "# vellum's environment. Values never live in the repo.",
  "",
  "# @sensitive @required",
  "# @type=string(startsWith=sntrys_)",
  "# @docsUrl=https://docs.sentry.io/account/auth-tokens/",
  "# Uploads source maps and error reports from `vellum export`.",
  "SENTRY_AUTH_TOKEN=",
  "",
  "# @type=url",
  "# Where error reports go; public.",
  "SENTRY_DSN=",
  "",
  "# @type=string",
  "# A folder of fonts the PDF export embeds.",
  "VELLUM_FONT_DIR=",
  "",
  "# @deprecated The PDF export no longer shells out; it is ignored.",
  "LEGACY_PDF_ENGINE=",
  "",
].join("\n");

/** How many decisions a vellum decider takes a day (its `policy.json`'s budget). */
export const decisionsPerDay = 5;

/** How long a claim goes without a push before it is warned, then lapses. */
const CLAIMS = { lapseAfter: { hours: 96 }, warnAfter: { hours: 48 } } as const;

const HOUR_MS = 3_600_000;

const policy = policyJson({
  asks: [],
  budget: { decisionsPerDay, expireDays: 3 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: {
    lapseAfterMs: CLAIMS.lapseAfter.hours * HOUR_MS,
    warnAfterMs: CLAIMS.warnAfter.hours * HOUR_MS,
  },
  deciders: [
    { handles: [people.ines], paths: "**" },
    { handles: [people.ines, people.lin], paths: `${dir}/**` },
    { handles: [people.okonkwo], paths: "packages/export/**" },
    { handles: [people.okonkwo], paths: ".env.schema" },
    { handles: [people.okonkwo], paths: `${dir}/vouched.td` },
  ],
  functions: { admit: false, opensAlone: false },
  kinds: [
    {
      checkKind: "redThenGreen",
      claimers: "vouched",
      finish: "optional",
      name: "fix",
      oneWay: false,
      race: 1,
      requires: ["want", "check", "territory"],
      strength: "assertion",
    },
    {
      checkKind: "redThenGreen",
      claimers: "vouched",
      finish: "required",
      name: "polish",
      oneWay: false,
      race: 1,
      requires: ["want", "check", "territory"],
      strength: "assertion",
    },
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
      measure: Schema.encodeSync(RatchetMeasure)(
        RatchetMeasure.cases.Metric.make({
          command: Command.make("bun scripts/bundle-size.ts --json"),
          path: JsonPath.make("$.bytes"),
        })
      ),
      name: "bundle-bytes",
    },
  ],
  run: { checks: LANES, test: TEST },
  source: "config",
  weakening: { markers: [".skip(", ".only(", ".todo("] },
});

/** vellum's first push: six packages, its config folder and its env schema. */
export const vellumFiles: Files = new Map([
  [
    "README.md",
    [
      "# vellum",
      "",
      "Reads and writes a small document format: a parser, a renderer, themes, a linter, an exporter (HTML, EPUB and PDF) and a CLI.",
      "",
      "A fictional project: it and its people are invented.",
      "",
    ].join("\n"),
  ],
  [
    "package.json",
    `${JSON.stringify(
      {
        name: "vellum",
        private: true,
        scripts: {
          lint: "oxlint",
          test: "bun test",
          typecheck: "tsc --noEmit",
        },
        workspaces: ["packages/*"],
      },
      null,
      2
    )}\n`,
  ],
  [".env.schema", ENV_SCHEMA],
  [
    "scripts/count-callers.ts",
    [
      "// Prints how many times each package calls a name, as JSON.",
      'import { Glob } from "bun";',
      "",
      "const [name] = Bun.argv.slice(2);",
      "const byModule: Record<string, number> = {};",
      "",
      'for await (const path of new Glob("packages/*/src/**/*.ts").scan()) {',
      '  const module = "@vellum/" + path.split("/")[1];',
      '  byModule[module] = (byModule[module] ?? 0) + ((await Bun.file(path).text()).split(name + "(").length - 1);',
      "}",
      "",
      "console.log(JSON.stringify({ byModule, total: Object.values(byModule).reduce((a, b) => a + b, 0) }));",
      "",
    ].join("\n"),
  ],
  ...MODULES.flatMap((module): (readonly [string, string])[] => [
    [`packages/${module}/package.json`, packageJson(module)],
    [
      `packages/${module}/src/index.ts`,
      module === "parser"
        ? [
            "export interface Token {",
            '  readonly kind: "word" | "mark";',
            "  readonly text: string;",
            "}",
            "",
            'export { oldTokenize, tokenize } from "./tokenize.ts";',
            "",
          ].join("\n")
        : entryOf(module, "oldTokenize"),
    ],
  ]),
  [
    "packages/parser/src/tokenize.ts",
    [
      'import type { Token } from "./index.ts";',
      "",
      "const read = (text: string): Token[] =>",
      "  text.split(/(\\s+|[*_`#>])/u).filter(Boolean).map((part) => ({",
      '    kind: /^[*_`#>]$/u.test(part) ? "mark" : "word",',
      "    text: part,",
      "  }));",
      "",
      "/** The tokenizer every package moves to. */",
      "export const tokenize = read;",
      "",
      "/** The first tokenizer, kept until nothing calls it. */",
      "export const oldTokenize = (text: string): Token[] => read(text.trim());",
      "",
    ].join("\n"),
  ],
  ...PAGED.map(
    (module) =>
      [`packages/${module}/src/page.ts`, pageOf(module, "pageSize")] as const
  ),
  [`${dir}/policy.json`, policy],
  [
    `${dir}/vouched.td`,
    [
      "# The people vellum's deciders vouch for.",
      people.bram,
      people.okafor,
      people.lin,
      `${people.tove} Started with the CLI docs.`,
      `${people.sefa} Came from the parser's issue thread.`,
      `-${people.wren} Opened proposals that advertised a paid fork.`,
      "",
    ].join("\n"),
  ],
]);

// ---------------------------------------------------------------- asks

/** An ask as the story opens it: everything but where and when it opened. */
type Stated = Omit<Ask, "openedAt" | "openedIn" | "project">;

const fix = (input: {
  readonly id: string;
  readonly module: Module;
  /** A territory other than the module's own. */
  readonly territory?: Territory;
  readonly want: string;
  readonly current?: string;
  readonly askedBy?: Handle;
  readonly kind?: "fix" | "polish";
  readonly blockedBy?: readonly AskId[];
  readonly mentor?: Handle;
}): Stated => {
  const id = AskId.make(input.id);

  const territory = input.territory ?? territoryOf(input.module);
  const home = `packages/${input.module}`;

  return {
    askedBy: input.askedBy ?? people.ines,
    blockedBy: input.blockedBy ?? [],
    brief: {
      want: input.want,
      ...present("current", input.current),
    },
    check: CheckSpec.cases.RedThenGreen.make({
      path: RepoPath.make(`${home}/test/asks/${input.id}.test.ts`),
    }),
    file: RepoPath.make(`${dir}/asks/${input.id}.ask.ts`),
    id,
    kind: KindName.make(input.kind ?? "fix"),
    state: "open",
    territory,
    ...present("mentor", input.mentor),
    ...present(
      "reserve",
      input.mentor === undefined ? undefined : ("newcomers" as const)
    ),
  };
};

/** The ask's file as its maintainer writes it, and its check's test. */
const filesOf = (asks: readonly Stated[]): Files =>
  new Map(
    asks.flatMap((ask) => {
      const stated: StatedAsk = {
        askedBy: ask.askedBy,
        blockedBy: [...ask.blockedBy],
        brief: ask.brief,
        check: encodeCheck(ask.check),
        file: ask.file,
        id: ask.id,
        kind: ask.kind,
        territory: {
          module: ask.territory.module,
          paths: [...ask.territory.paths],
        },
        ...present("mentor", ask.mentor),
        ...present("parent", ask.parent),
        ...present("reserve", ask.reserve),
      };

      const file = askFileOf(stated);

      const test = CheckSpec.guards.RedThenGreen(ask.check)
        ? [[ask.check.path, checkOf(ask.id, ask.id, ask.brief.want)] as const]
        : [];

      return [[file.path, file.content] as const, ...test];
    })
  );

/** A migrate ask split as the service splits one: a child per module, then the delete child. */
const familyOf = (input: {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly count: Command;
  readonly modules: Array.NonEmptyReadonlyArray<Module>;
  readonly callers: number;
}) => {
  const parentId = AskId.make(input.id);

  const check = CheckSpec.cases.Migrate.make({
    count: input.count,
    from: SymbolName.make(input.from),
    to: SymbolName.make(input.to),
  });

  const whole: Territory = {
    module: ".",
    paths: Array.map(input.modules, (module) => territoryOf(module).paths[0]),
  };

  const member = (
    id: AskId,
    own: Pick<Stated, "blockedBy" | "brief" | "check" | "state" | "territory">
  ): Stated => ({
    askedBy: people.ines,
    file: RepoPath.make(`${dir}/asks/${id}.ask.ts`),
    id,
    kind: KindName.make("migrate"),
    parent: parentId,
    ...own,
  });

  const children = Array.map(input.modules, (module) =>
    member(childId(parentId, moduleName(module)), {
      blockedBy: [],
      brief: {
        want: `${moduleName(module)}: ${input.callers} callers of ${input.from} → ${input.to}`,
      },
      check,
      state: "open",
      territory: territoryOf(module),
    })
  );

  const ids = children.map(({ id }) => id);
  const deleteId = deleteChildId(parentId);

  const last = member(deleteId, {
    blockedBy: ids,
    brief: { want: `Delete ${input.from}: nothing calls it any more` },
    check: CheckSpec.cases.SymbolAbsent.make({
      count: input.count,
      symbol: SymbolName.make(input.from),
    }),
    state: "waitingOnParent",
    territory: whole,
  });

  const parent: Stated = {
    askedBy: people.ines,
    blockedBy: [...ids, deleteId],
    brief: {
      want: `Replace every call to ${input.from} with ${input.to}, then delete ${input.from}.`,
    },
    check,
    file: RepoPath.make(`${dir}/asks/${input.id}.ask.ts`),
    id: parentId,
    kind: KindName.make("migrate"),
    state: "open",
    territory: whole,
  };

  return {
    asks: Array.make(parent, ...children, last),
    child: (module: Module) => childId(parentId, moduleName(module)),
  };
};

const tokenizer = familyOf({
  callers: 2,
  count: COUNT,
  from: "oldTokenize",
  id: "retire-old-tokenizer",
  modules: ["cli", "export", "lint", "parser", "render", "themes"],
  to: "tokenize",
});

const pageSize = familyOf({
  callers: 1,
  count: COUNT_PAGES,
  from: "pageSize",
  id: "rename-page-size",
  modules: ["cli", "render", "themes"],
  to: "pageFormat",
});

const ask = {
  carry: fix({
    current: "An EPUB export drops every footnote.",
    id: "carry-footnotes-to-epub",
    module: "parser",
    territory: {
      module: ".",
      paths: Schema.decodeSync(Territory.fields.paths)([
        "packages/parser/src/footnotes.ts",
        "packages/export/src/epub.ts",
      ]),
    },
    want: "Footnotes the parser reads reach the EPUB export as linked endnotes.",
  }),
  cliVersion: fix({
    id: "cli-version-flag",
    module: "cli",
    want: "vellum --version prints the version and exits 0.",
  }),
  docs: fix({
    current: "vellum --help lists flags with no word on what they do.",
    id: "document-cli-flags",
    mentor: people.okonkwo,
    module: "cli",
    want: "vellum --help says what each flag does, in one line each.",
  }),
  escape: fix({
    id: "escape-attribute-quotes",
    module: "render",
    want: "The HTML renderer escapes quotes inside attribute values.",
  }),
  exportErrors: fix({
    id: "report-export-errors",
    module: "export",
    want: "A failed export reports its error, with the document's path, to the project's error tracker.",
  }),
  exportPages: fix({
    id: "export-page-numbers",
    module: "export",
    want: "The PDF export prints page numbers in the footer.",
  }),
  headings: fix({
    askedBy: people.tove,
    id: "lint-heading-levels",
    module: "lint",
    want: "The linter reports a heading that skips a level, such as a level-two heading followed by a level-four one, with the line of the skip.",
  }),
  nested: fix({
    id: "render-nested-lists",
    module: "render",
    want: "A list nested three deep renders with its indentation.",
  }),
  backrefs: fix({
    blockedBy: [AskId.make("number-footnotes")],
    id: "footnote-backrefs",
    module: "render",
    want: "Each footnote links back to where it is cited.",
  }),
  codeBlocks: fix({
    id: "render-code-blocks",
    module: "render",
    want: "A fenced code block keeps its blank lines.",
  }),
  numbers: fix({
    id: "number-footnotes",
    module: "parser",
    want: "The parser numbers footnotes in the order they are cited.",
  }),
  quotes: fix({
    id: "parse-smart-quotes",
    module: "parser",
    want: "The parser reads curly quotes as quotes.",
  }),
  altText: fix({
    id: "export-alt-text",
    module: "export",
    want: "The HTML export keeps an image's alt text.",
  }),
  palette: fix({
    id: "themes-dark-palette",
    module: "themes",
    want: "The default theme has a dark palette.",
  }),
  trim: fix({
    id: "trim-trailing-spaces",
    module: "lint",
    want: "The linter reports trailing spaces at the end of a line.",
  }),
  wrap: fix({
    id: "wrap-long-table-cells",
    kind: "polish",
    module: "render",
    want: "A table cell longer than the column wraps instead of widening the table.",
  }),
} as const;

/** An answer's change: one file in the ask's own module. */
const answerFiles = (stated: Stated, body: string): Files => {
  const home =
    stated.territory.module === "."
      ? "packages/parser"
      : `packages/${stated.territory.module.replace("@vellum/", "")}`;

  return new Map([
    [
      `${home}/src/${stated.id}.ts`,
      [`/** ${stated.brief.want} */`, body, ""].join("\n"),
    ],
  ]);
};

const passed = { lint: "passed", types: "passed", unit: "passed" } as const;

const allPassed = (askLane: string) =>
  ({ ...passed, [askLane]: "passed" }) as const;

// ----------------------------------------------------------- decisions

const decisionId = (n: number) =>
  DecisionId.make(`dec-${String(n).padStart(6, "0")}`);

const proposalId = (n: number) =>
  ProposalId.make(`prop-${String(n).padStart(6, "0")}`);

const EXPIRY = { days: 3 } as const;

const decision = (input: {
  readonly n: number;
  readonly at: DateTime.Utc;
  readonly deciders: Array.NonEmptyReadonlyArray<Handle>;
  readonly subject: DecisionSubject;
  readonly evidence: Decision["evidence"];
  readonly default?: Decision["default"];
}): Decision => ({
  deciders: input.deciders,
  default: input.default ?? "decline",
  evidence: input.evidence,
  expiresAt: DateTime.add(input.at, EXPIRY),
  id: decisionId(input.n),
  openedAt: input.at,
  project: vellum,
  subject: input.subject,
});

/** The finish's diff: the answer's second round, whose test the first round had narrowed with `.only(`. */
const WRAP_PATCH = [
  "diff --git a/packages/render/src/table.ts b/packages/render/src/table.ts",
  "index 5d1c0e2..a8f4b71 100644",
  "--- a/packages/render/src/table.ts",
  "+++ b/packages/render/src/table.ts",
  "@@ -1,8 +1,14 @@",
  ' import type { Token } from "@vellum/parser";',
  " ",
  "+const MAX_CELL = 40;",
  "+",
  " /** One table cell, as HTML. */",
  "-export const cell = (tokens: Token[]) =>",
  '-  "<td>" + tokens.map((token) => token.text).join("") + "</td>";',
  "+export const cell = (tokens: Token[]) => {",
  '+  const text = tokens.map((token) => token.text).join("");',
  '+  const wrap = text.length > MAX_CELL ? \' style="overflow-wrap:anywhere"\' : "";',
  "+",
  '+  return "<td" + wrap + ">" + text + "</td>";',
  "+};",
  " ",
  " /** One table, as HTML. */",
  " export const table = (rows: Token[][][]) =>",
  "diff --git a/packages/render/test/table.test.ts b/packages/render/test/table.test.ts",
  "new file mode 100644",
  "index 0000000..3b9e2d4",
  "--- /dev/null",
  "+++ b/packages/render/test/table.test.ts",
  "@@ -0,0 +1,18 @@",
  '+import { expect, test } from "bun:test";',
  "+",
  '+import { cell } from "../src/table.ts";',
  "+",
  '+const word = (text: string) => ({ kind: "word" as const, text });',
  "+",
  '+test("a short cell stays on one line", () => {',
  '+  expect(cell([word("short")])).toBe("<td>short</td>");',
  "+});",
  "+",
  '+test("a long cell wraps instead of widening its table", () => {',
  '+  const long = word("a".repeat(64));',
  "+",
  '+  expect(cell([long])).toContain("overflow-wrap:anywhere");',
  "+  expect(cell([long])).toContain(long.text);",
  "+});",
  "+",
  "+// One case per width the renderer supports lives in table.widths.test.ts.",
  "",
].join("\n");

// ---------------------------------------------------------------- ledger

/** The ledger's standing parts; its entries are told with the story. */
const ledger: Ledger = {
  entries: [],
  layers: [
    {
      audience: "maintainers",
      disclose: "sealed",
      holds: ["checks", "notes"],
      name: LayerName.make("maintainers"),
      readers: [people.ines, people.okonkwo, people.lin],
      reason:
        "Held-back checks for the export and the parser, written by the maintainers so an answer cannot be fitted to them.",
      repo: RepoName.make("vellum--maintainers"),
      writers: "deciders",
    },
  ],
  posture: "openWithSealedEvidence",
  postureLabel: "Open with sealed evidence · sealed checks in export, parser",
  project: vellum,
};

/**
 * The env shape at `at`: four items, one write-only and set at `setAt`,
 * none with a value or placeholder.
 */
const envAt = (at: LandedSha, setAt: DateTime.Utc): EnvSchemaView => ({
  at,
  file: RepoPath.make(".env.schema"),
  imports: [],
  items: [
    {
      description:
        "Uploads source maps and error reports from `vellum export`.",
      docs: "https://docs.sentry.io/account/auth-tokens/",
      key: EnvKey.make("SENTRY_AUTH_TOKEN"),
      proxy: { domains: ["sentry.io"], path: "/api/**" },
      required: true,
      sensitive: true,
      tags: ["export", "errors"],
      type: 'string(startsWith="sntrys_")',
      value: { setAt, setBy: people.ines },
    },
    {
      description: "Where error reports go; public.",
      key: EnvKey.make("SENTRY_DSN"),
      required: false,
      sensitive: false,
      tags: ["errors"],
      type: "url",
    },
    {
      description: "A folder of fonts the PDF export embeds.",
      key: EnvKey.make("VELLUM_FONT_DIR"),
      required: "depends",
      sensitive: false,
      tags: ["export"],
      type: "string",
    },
    {
      deprecated: true,
      description: "The PDF export no longer shells out; it is ignored.",
      key: EnvKey.make("LEGACY_PDF_ENGINE"),
      required: false,
      sensitive: false,
      tags: [],
    },
  ],
  project: vellum,
});

// ------------------------------------------------------------- proposals

const proposal = (input: {
  readonly n: number;
  readonly at: DateTime.Utc;
  readonly proposer: Handle;
  readonly want: string;
  readonly files: readonly RepoPath[];
  readonly draft?: Proposal["draft"];
  readonly state?: Proposal["state"];
}): Proposal => ({
  expiresAt: DateTime.add(input.at, { days: 14 }),
  files: input.files,
  id: proposalId(input.n),
  openedAt: input.at,
  project: vellum,
  proposer: input.proposer,
  state: input.state ?? "open",
  want: input.want,
  ...present("draft", input.draft),
});

/** A drafted ask's three files: its ask file, its check, and the document the check reads. */
const draftedFiles = (id: string, module: Module, want: string) => {
  const stated = fix({ id, module, want });
  const [askFile, testFile] = [...filesOf([stated])];

  const fixture = [
    `packages/${module}/test/fixtures/${id}.vm`,
    "- a list item\n  > a quote inside it\n",
  ] as const;

  return [askFile, testFile, fixture].flatMap((entry) =>
    entry === undefined
      ? []
      : [{ content: entry[1], path: RepoPath.make(entry[0]) }]
  );
};

/** A family child's change: its module's entry on the new tokenizer. */
const childEntry = (module: Module): Files =>
  new Map([[`packages/${module}/src/index.ts`, entryOf(module, "tokenize")]]);

/** A family child's change: its module's page settings under the new name. */
const childPage = (module: Module): Files =>
  new Map([[`packages/${module}/src/page.ts`, pageOf(module, "pageFormat")]]);

// ------------------------------------------------------------- the story

/**
 * The record vellum's story writes, over its canonical repo standing at
 * `base`: each instant written on the calendar, placed in this world.
 */
export const tellVellum = (base: LandedSha) =>
  Effect.gen(function* () {
    const { place } = yield* DevClock;

    const t = (text: string) => place(instant(text));

    const story = yield* storyOf({
      base,
      files: vellumFiles,
      lanes: LANES,
      lapseAfter: CLAIMS.lapseAfter,
      project: vellum,
      test: TEST,
      warnAfter: CLAIMS.warnAfter,
    });

    const answerAndLand = (input: {
      readonly stated: Stated;
      readonly who: Handle;
      readonly claimed: string;
      readonly landed: string;
      readonly lane?: string;
      readonly heldBack?: readonly HeldBackResult[];
      readonly changes?: Files;
      readonly suite?: HeldBackResult["suite"];
    }) =>
      Effect.gen(function* () {
        story.claim(input.stated.id, input.who, t(input.claimed), input.suite);

        const head = story.push(input.stated.id, t(input.landed));

        story.judge(input.stated.id, head, {
          at: t(input.landed),
          lanes: allPassed(input.lane ?? "redThenGreen"),
          outcome: Outcome.cases.Checking.make({ stage: "human" }),
          stage: "human",
          ...present("heldBack", input.heldBack),
        });

        return yield* story.land(input.stated.id, {
          at: t(input.landed),
          changes:
            input.changes ??
            answerFiles(
              input.stated,
              `export const answered = ${JSON.stringify(input.stated.id)};`
            ),
        });
      });

    // September: the first asks, answered by the people who have been here longest.
    yield* story.open({
      asks: [ask.quotes],
      at: t("2026-09-01T10:00"),
      by: people.ines,
      files: filesOf([ask.quotes]),
    });
    yield* answerAndLand({
      claimed: "2026-09-02T10:00",
      landed: "2026-09-03T14:00",
      stated: ask.quotes,
      who: people.bram,
    });
    yield* story.open({
      asks: [ask.altText],
      at: t("2026-09-09T10:00"),
      by: people.ines,
      files: filesOf([ask.altText]),
    });
    yield* answerAndLand({
      claimed: "2026-09-10T09:00",
      landed: "2026-09-11T11:00",
      stated: ask.altText,
      who: people.okafor,
    });
    yield* story.open({
      asks: [ask.palette],
      at: t("2026-09-15T10:00"),
      by: people.ines,
      files: filesOf([ask.palette]),
    });

    const palette = yield* answerAndLand({
      claimed: "2026-09-15T11:00",
      landed: "2026-09-16T16:00",
      stated: ask.palette,
      who: people.lin,
    });

    yield* story.tag("v0.8.0", palette.sha);

    // The maintainers' layer, and the posture change that seals its checks.
    story.decision(
      decision({
        at: t("2026-09-28T09:00"),
        deciders: [people.ines, people.lin],
        evidence: [
          {
            label: "why",
            value:
              "Answers to the export and the parser were fitted to their tests; held-back checks judge them instead.",
          },
          { label: "notice", value: "3 days" },
        ],
        n: 1,
        subject: Subject.cases.PostureChange.make({
          from: "open",
          to: "openWithSealedEvidence",
        }),
      })
    );
    story.record((seq) =>
      LedgerEntry.cases.LayerDeclared.make({
        at: t("2026-09-29T10:00"),
        disclose: "sealed",
        kinds: ["checks", "notes"],
        layer: LayerName.make("maintainers"),
        seq,
      })
    );
    story.decide(decisionId(1), {
      at: t("2026-10-01T08:30"),
      by: people.ines,
      choice: "accept",
      note: "Notice runs three days; the suites go in on the 4th.",
    });

    yield* story.open({
      asks: [ask.docs],
      at: t("2026-10-01T15:00"),
      by: people.ines,
      files: filesOf([ask.docs]),
    });
    story.claim(ask.docs.id, people.tove, t("2026-10-02T10:00"));

    story.record((seq) =>
      LedgerEntry.cases.PostureChanged.make({
        at: t("2026-10-04T09:00"),
        decision: decisionId(1),
        from: "open",
        seq,
        to: "openWithSealedEvidence",
      })
    );
    story.record((seq) =>
      LedgerEntry.cases.CommitmentPublished.make({
        area: EXPORT,
        at: t("2026-10-04T09:05"),
        authors: 3,
        checks: 7,
        seq,
        suite: exportSuite,
      })
    );
    story.record((seq) =>
      LedgerEntry.cases.CommitmentPublished.make({
        area: PARSER,
        at: t("2026-10-04T09:06"),
        authors: 3,
        checks: 4,
        seq,
        suite: parserSuite,
      })
    );

    // October 4: the second family opens, and the standalone asks.
    yield* story.open({
      asks: pageSize.asks,
      at: t("2026-10-04T09:30"),
      by: people.ines,
      files: filesOf(pageSize.asks),
    });

    for (const [stated, minute] of [
      [ask.codeBlocks, "40"],
      [ask.escape, "41"],
      [ask.wrap, "42"],
    ] as const) {
      yield* story.open({
        asks: [stated],
        at: t(`2026-10-04T09:${minute}`),
        by: people.ines,
        files: filesOf([stated]),
      });
    }

    story.warn(ask.docs.id, t("2026-10-04T10:00"));

    // render-code-blocks: refused twice, landed in its third round.
    story.claim(ask.codeBlocks.id, people.lin, t("2026-10-04T10:00"));

    const codeRound1 = story.push(ask.codeBlocks.id, t("2026-10-04T11:00"), 1);

    story.judge(ask.codeBlocks.id, codeRound1, {
      at: t("2026-10-04T11:00"),
      lanes: {
        lint: "passed",
        redThenGreen: "passed",
        types: "failed",
        unit: "passed",
      },
      logs: {
        types:
          "packages/render/src/code-blocks.ts(4,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.\n",
      },
      outcome: Outcome.cases.Refused.make({
        refusals: [
          new ChecksFailed({
            lane: "types",
            logRef: `push-${codeRound1}-${people.lin}/types`,
            next: LANES.types,
          }),
        ],
      }),
      stage: "checks",
    });

    story.claim(ask.escape.id, people.bram, t("2026-10-04T12:00"));
    story.claim(pageSize.child("cli"), people.bram, t("2026-10-04T13:00"));

    const codeRound2 = story.push(ask.codeBlocks.id, t("2026-10-04T15:00"), 2);

    story.judge(ask.codeBlocks.id, codeRound2, {
      at: t("2026-10-04T15:00"),
      lanes: {},
      outcome: Outcome.cases.Refused.make({
        refusals: [
          new Weakened({
            at: {
              line: 22,
              path: RepoPath.make("packages/render/test/code-blocks.test.ts"),
            },
            weakening: { marker: ".skip(" },
          }),
        ],
      }),
      stage: "shape",
    });

    // escape-attribute-quotes waits on a waiver for the test it skips.
    const escapeHead = story.push(ask.escape.id, t("2026-10-04T15:00"));

    const escapeAt = {
      line: 9,
      path: RepoPath.make("packages/render/test/attributes.test.ts"),
    };

    const escapeReason =
      "A quote inside a code span needs the escaper's context; split out as its own ask.";

    story.judge(ask.escape.id, escapeHead, {
      at: t("2026-10-04T15:00"),
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.AwaitingDecision.make({ decision: decisionId(2) }),
      stage: "human",
    });
    story.decision(
      decision({
        at: t("2026-10-04T15:00"),
        deciders: [people.ines],
        evidence: [
          {
            label: "answer",
            value: `${people.bram} at ${escapeHead} (push-${escapeHead}-${people.bram})`,
          },
          {
            label: "escape",
            value: `${escapeAt.path}:${escapeAt.line}: .skip( -- ${escapeReason}`,
          },
        ],
        n: 2,
        subject: Subject.cases.Waiver.make({
          ask: ask.escape.id,
          at: escapeAt,
          marker: ".skip(",
          reason: escapeReason,
        }),
      })
    );

    story.claim(ask.wrap.id, people.okafor, t("2026-10-04T16:00"));

    const cliPage = story.push(pageSize.child("cli"), t("2026-10-04T17:00"));

    story.judge(pageSize.child("cli"), cliPage, {
      at: t("2026-10-04T17:00"),
      lanes: allPassed("migrate"),
      outcome: Outcome.cases.Checking.make({ stage: "human" }),
      stage: "human",
    });
    yield* story.land(pageSize.child("cli"), {
      at: t("2026-10-04T17:00"),
      changes: childPage("cli"),
    });

    // October 5.
    story.record((seq) =>
      LedgerEntry.cases.Admitted.make({
        area: EXPORT,
        at: t("2026-10-05T07:00"),
        knownBadCaught: 3,
        mainRuns: 12,
        seq,
        suite: exportSuite,
      })
    );
    story.record((seq) =>
      LedgerEntry.cases.CountChanged.make({
        area: EXPORT,
        at: t("2026-10-05T07:01"),
        count: 7,
        layer: LayerName.make("maintainers"),
        seq,
      })
    );

    story.claim(pageSize.child("render"), people.okafor, t("2026-10-05T08:00"));
    story.claim(pageSize.child("themes"), people.lin, t("2026-10-05T09:00"));
    yield* story.open({
      asks: tokenizer.asks,
      at: t("2026-10-05T09:00"),
      by: people.ines,
      files: filesOf(tokenizer.asks),
    });

    const codeRound3 = story.push(ask.codeBlocks.id, t("2026-10-05T09:30"), 3);

    story.judge(ask.codeBlocks.id, codeRound3, {
      at: t("2026-10-05T09:30"),
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.Checking.make({ stage: "human" }),
      stage: "human",
    });
    yield* story.land(ask.codeBlocks.id, {
      at: t("2026-10-05T09:30"),
      changes: answerFiles(
        ask.codeBlocks,
        "export const keepsBlankLines = true;"
      ),
    });

    story.claim(tokenizer.child("render"), people.sefa, t("2026-10-05T09:30"));
    story.claim(tokenizer.child("cli"), people.bram, t("2026-10-05T10:00"));

    // wrap-long-table-cells: narrowed with .only( in its first round, then waiting for a finish.
    const wrapRound1 = story.push(ask.wrap.id, t("2026-10-05T10:00"), 1);

    story.judge(ask.wrap.id, wrapRound1, {
      at: t("2026-10-05T10:00"),
      lanes: {},
      outcome: Outcome.cases.Refused.make({
        refusals: [
          new Weakened({
            at: {
              line: 14,
              path: RepoPath.make("packages/render/test/table.test.ts"),
            },
            weakening: { marker: ".only(" },
          }),
        ],
      }),
      stage: "shape",
    });

    story.claim(
      tokenizer.child("export"),
      people.okafor,
      t("2026-10-05T11:00"),
      exportSuite
    );

    const renderPage = story.push(
      pageSize.child("render"),
      t("2026-10-05T11:00")
    );

    story.judge(pageSize.child("render"), renderPage, {
      at: t("2026-10-05T11:00"),
      lanes: allPassed("migrate"),
      outcome: Outcome.cases.Checking.make({ stage: "human" }),
      stage: "human",
    });
    yield* story.land(pageSize.child("render"), {
      at: t("2026-10-05T11:00"),
      changes: childPage("render"),
    });

    const themesPage = story.push(
      pageSize.child("themes"),
      t("2026-10-05T12:00")
    );

    story.judge(pageSize.child("themes"), themesPage, {
      at: t("2026-10-05T12:00"),
      lanes: allPassed("migrate"),
      outcome: Outcome.cases.Checking.make({ stage: "human" }),
      stage: "human",
    });
    yield* story.land(pageSize.child("themes"), {
      at: t("2026-10-05T12:00"),
      changes: childPage("themes"),
    });

    // The lint ask came from tove's proposal.
    story.propose({
      files: [],
      proposal: proposal({
        at: t("2026-10-05T13:00"),
        files: [],
        n: 1,
        proposer: people.tove,
        want: ask.headings.brief.want,
      }),
    });
    story.decision(
      decision({
        at: t("2026-10-05T13:00"),
        deciders: [people.ines, people.lin],
        evidence: [
          { label: "want", value: ask.headings.brief.want },
          { label: "territory", value: "@vellum/lint" },
        ],
        n: 3,
        subject: Subject.cases.OpenProposal.make({ proposal: proposalId(1) }),
      })
    );

    const wrapHead = story.push(ask.wrap.id, t("2026-10-05T14:00"), 2);

    story.judge(ask.wrap.id, wrapHead, {
      at: t("2026-10-05T14:00"),
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.AwaitingFinish.make({ decider: people.ines }),
      stage: "human",
    });
    story.decision(
      decision({
        at: t("2026-10-05T14:00"),
        default: "accept",
        deciders: [people.ines],
        evidence: [
          {
            label: "answer",
            value: `${people.okafor} at ${wrapHead} (push-${wrapHead}-${people.okafor})`,
          },
          { label: "patch", value: WRAP_PATCH },
          {
            label: "fork",
            value: `${vellum}--${ask.wrap.id}--${people.okafor}`,
          },
        ],
        n: 4,
        subject: Subject.cases.Finish.make({
          ask: ask.wrap.id,
          head: wrapHead,
        }),
      })
    );

    const cliChild = story.push(tokenizer.child("cli"), t("2026-10-05T14:00"));

    story.judge(tokenizer.child("cli"), cliChild, {
      at: t("2026-10-05T14:00"),
      lanes: allPassed("migrate"),
      outcome: Outcome.cases.Checking.make({ stage: "human" }),
      stage: "human",
    });

    const released = yield* story.land(tokenizer.child("cli"), {
      at: t("2026-10-05T14:00"),
      changes: childEntry("cli"),
    });

    yield* story.tag("v0.9.0", released.sha);

    for (const [stated, minute] of [
      [ask.numbers, "10"],
      [ask.backrefs, "11"],
      [ask.trim, "12"],
      [ask.nested, "13"],
      [ask.cliVersion, "14"],
      [ask.exportPages, "15"],
      [ask.exportErrors, "16"],
      [ask.carry, "17"],
    ] as const) {
      yield* story.open({
        asks: [stated],
        at: t(`2026-10-05T15:${minute}`),
        by: people.ines,
        files: filesOf([stated]),
      });
    }

    const ready = draftedFiles(
      "parse-nested-quotes",
      "parser",
      "The parser reads a blockquote nested inside a list item."
    );

    story.propose(
      {
        files: ready,
        proposal: proposal({
          at: t("2026-10-05T15:30"),
          draft: DraftState.cases.Ready.make({
            attempts: 1,
            model: "memory",
            red: {
              lane: LaneName.make("redThenGreen"),
              signature: "expected 1 blockquote, received 0",
            },
            round: 1,
          }),
          files: ready.map(({ path }) => path),
          n: 2,
          proposer: people.bram,
          want: "The parser reads a blockquote nested inside a list item.",
        }),
      },
      { at: t("2026-10-05T16:00"), ready: true }
    );
    story.decision(
      decision({
        at: t("2026-10-05T16:00"),
        deciders: [people.ines],
        evidence: [
          {
            label: "want",
            value: "The parser reads a blockquote nested inside a list item.",
          },
          { label: "territory", value: "@vellum/parser" },
          ...ready.map(({ content, path }) => ({
            label: path,
            value: content,
          })),
          {
            label: "red first",
            value: "redThenGreen: expected 1 blockquote, received 0",
          },
          { label: "drafted by", value: "memory, attempt 1 of 3" },
        ],
        n: 5,
        subject: Subject.cases.OpenProposal.make({ proposal: proposalId(2) }),
      })
    );

    story.claim(
      tokenizer.child("parser"),
      people.tove,
      t("2026-10-05T16:00"),
      parserSuite
    );

    // October 6.
    story.decision(
      decision({
        at: t("2026-10-06T07:00"),
        deciders: [people.ines, people.lin],
        evidence: [
          {
            label: "why",
            value:
              "The maintainers' notes become public a month after each release.",
          },
          {
            label: "notice",
            value:
              "3 days: it takes effect on the third day after it is accepted",
          },
        ],
        n: 6,
        subject: Subject.cases.PostureChange.make({
          from: "openWithSealedEvidence",
          to: "openOnSchedule",
        }),
      })
    );

    story.claim(ask.nested.id, people.tove, t("2026-10-06T08:00"));
    story.claim(ask.carry.id, people.okafor, t("2026-10-06T08:30"));

    const exportChild = story.push(
      tokenizer.child("export"),
      t("2026-10-06T09:00")
    );

    story.judge(tokenizer.child("export"), exportChild, {
      at: t("2026-10-06T09:00"),
      heldBack: [held(EXPORT, 7, 7)],
      lanes: allPassed("migrate"),
      outcome: Outcome.cases.Checking.make({ stage: "human" }),
      stage: "human",
    });
    yield* story.land(tokenizer.child("export"), {
      at: t("2026-10-06T09:00"),
      changes: childEntry("export"),
    });

    story.claim(ask.numbers.id, people.lin, t("2026-10-06T09:00"), parserSuite);
    story.claim(tokenizer.child("lint"), people.lin, t("2026-10-06T10:00"));
    story.lapse(ask.docs.id, t("2026-10-06T10:00"));
    story.claim(ask.backrefs.id, people.bram, t("2026-10-06T11:00"));
    story.decision(
      decision({
        at: t("2026-10-06T11:00"),
        default: "revert",
        deciders: [people.ines, people.lin],
        evidence: [
          { label: "ref", value: "refs/heads/main" },
          {
            label: "pusher",
            value: "not known: the push came past the platform",
          },
        ],
        n: 7,
        subject: Subject.cases.StrayPush.make({
          after: headOf("vellum/stray"),
          before: story.head(),
          ref: MAIN_REF,
        }),
      })
    );

    story.claim(ask.trim.id, people.sefa, t("2026-10-06T12:00"));

    const release = yield* story.landOwn({
      at: t("2026-10-06T12:00"),
      author: people.okonkwo,
      changes: new Map([
        [
          "packages/export/test/fixtures/epub-minimal.vm",
          "# A title\n\nOne paragraph.\n",
        ],
        [
          "packages/export/test/fixtures/epub-footnotes.vm",
          "A claim.[^1]\n\n[^1]: Its source.\n",
        ],
      ]),
      credits: [{ handle: people.okonkwo, role: "Released-by" }],
      message: {
        body: "Two documents the export's held-back checks read, released from the maintainers' layer.",
        subject: "Release two export fixtures",
      },
    });

    story.record((seq) =>
      LedgerEntry.cases.Released.make({
        at: t("2026-10-06T12:00"),
        by: people.okonkwo,
        landing: release.sha,
        layer: LayerName.make("maintainers"),
        paths: 2,
        seq,
      })
    );

    // render-nested-lists: refused at the checks, with the failing lane's log.
    const nestedHead = story.push(ask.nested.id, t("2026-10-06T12:30"));

    story.judge(ask.nested.id, nestedHead, {
      at: t("2026-10-06T12:30"),
      lanes: {
        lint: "passed",
        redThenGreen: "passed",
        types: "passed",
        unit: "failed",
      },
      logs: {
        unit: [
          "bun test v1.4.2",
          "",
          "packages/render/test/lists.test.ts:",
          "✓ a flat list renders [0.41ms]",
          "✗ a list nested two deep keeps its indentation [1.02ms]",
          '  expected: "<ul><li>a<ul><li>b</li></ul></li></ul>"',
          '  received: "<ul><li>a</li><li>b</li></ul>"',
          "",
          " 1 pass",
          " 1 fail",
          "",
        ].join("\n"),
      },
      outcome: Outcome.cases.Refused.make({
        refusals: [
          new ChecksFailed({
            lane: "unit",
            logRef: `push-${nestedHead}-${people.tove}/unit`,
            next: LANES.unit,
          }),
        ],
      }),
      stage: "checks",
    });

    // trim-trailing-spaces: refused at Shape, a change outside its territory.
    const trimHead = story.push(ask.trim.id, t("2026-10-06T13:00"));
    const outside = RepoPath.make("packages/cli/src/args.ts");

    story.judge(ask.trim.id, trimHead, {
      at: t("2026-10-06T13:00"),
      lanes: {},
      outcome: Outcome.cases.Refused.make({
        refusals: [
          new OutOfScope({ at: { line: 3, path: outside }, paths: [outside] }),
        ],
      }),
      stage: "shape",
    });

    story.claim(ask.cliVersion.id, people.bram, t("2026-10-06T13:00"));
    story.claim(
      ask.exportPages.id,
      people.okafor,
      t("2026-10-06T13:30"),
      exportSuite
    );

    const pagesHead = story.push(ask.exportPages.id, t("2026-10-06T14:00"));

    story.judge(ask.exportPages.id, pagesHead, {
      at: t("2026-10-06T14:00"),
      heldBack: [held(EXPORT, 7, 7)],
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.AwaitingDecision.make({ decision: decisionId(8) }),
      stage: "human",
    });
    story.decision(
      decision({
        at: t("2026-10-06T14:00"),
        deciders: [people.okonkwo],
        evidence: [
          {
            label: "answer",
            value: `${people.okafor} at ${pagesHead} (push-${pagesHead}-${people.okafor})`,
          },
          {
            label: "ratchet",
            value: "bundle-bytes in @vellum/export: 41200 to 41850",
          },
        ],
        n: 8,
        subject: Subject.cases.RaiseRatchet.make({
          after: 41_850,
          ask: ask.exportPages.id,
          before: 41_200,
          ratchet: RatchetName.make("bundle-bytes"),
          territory: "@vellum/export",
        }),
      })
    );

    story.propose(
      {
        files: [],
        proposal: proposal({
          at: t("2026-10-06T14:30"),
          draft: DraftState.cases.Failed.make({
            attempts: 3,
            model: "memory",
            refusal: "NotRedFirst",
            round: 1,
          }),
          files: [],
          n: 3,
          proposer: people.sefa,
          want: "Themes can set their own font for code blocks.",
        }),
      },
      { at: t("2026-10-06T15:00"), ready: false }
    );
    story.decision(
      decision({
        at: t("2026-10-06T15:00"),
        deciders: [people.ines, people.lin],
        evidence: [
          {
            label: "want",
            value: "Themes can set their own font for code blocks.",
          },
          {
            label: "draft failed",
            value:
              "The check passed on main, so it proves nothing about an answer.",
          },
        ],
        n: 9,
        subject: Subject.cases.OpenProposal.make({ proposal: proposalId(3) }),
      })
    );

    // The parser child: every lane passed, one held-back check in the parser did not.
    const parserHead = story.push(
      tokenizer.child("parser"),
      t("2026-10-06T15:00")
    );

    story.judge(tokenizer.child("parser"), parserHead, {
      at: t("2026-10-06T15:00"),
      heldBack: [held(PARSER, 3, 4)],
      lanes: allPassed("migrate"),
      outcome: Outcome.cases.Refused.make({
        refusals: [new HeldBackFailed({ area: PARSER, suite: parserSuite })],
      }),
      stage: "heldBack",
    });

    // footnote-backrefs passed, and waits for number-footnotes to land first.
    const backrefsHead = story.push(ask.backrefs.id, t("2026-10-06T16:00"));

    story.judge(ask.backrefs.id, backrefsHead, {
      at: t("2026-10-06T16:00"),
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.WaitingOnParent.make({ ask: ask.numbers.id }),
      stage: "human",
    });

    const token = EnvKey.make("SENTRY_AUTH_TOKEN");

    story.decision(
      decision({
        at: t("2026-10-06T16:00"),
        deciders: [people.okonkwo],
        evidence: [
          { label: "item", value: token },
          { label: "hosts now", value: "sentry.io" },
          { label: "hosts after", value: "sentry.io, ingest.sentry.io" },
        ],
        n: 10,
        subject: Subject.cases.ProxyWidened.make({
          hosts: WIDER_HOSTS,
          item: token,
        }),
      })
    );
    story.record((seq) =>
      LedgerEntry.cases.ValueSet.make({
        at: t("2026-10-06T16:30"),
        by: people.ines,
        key: token,
        seq,
      })
    );

    // cli-version-flag lands with no decision and nothing held back.
    const versionHead = story.push(ask.cliVersion.id, t("2026-10-06T17:30"));

    story.judge(ask.cliVersion.id, versionHead, {
      at: t("2026-10-06T17:30"),
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.Checking.make({ stage: "human" }),
      stage: "human",
    });
    yield* story.land(ask.cliVersion.id, {
      assisted: [{ harness: "claude-code", model: "haiku", verified: false }],
      at: t("2026-10-06T17:30"),
      changes: answerFiles(ask.cliVersion, 'export const version = "0.9.0";'),
    });

    // carry-footnotes-to-epub waits on a waiver for a `.todo(`, then lands with it.
    const carryHead = story.push(ask.carry.id, t("2026-10-06T18:00"));

    const carryAt = {
      line: 31,
      path: RepoPath.make("packages/export/test/epub.test.ts"),
    };

    const carryReason = "EPUB 2 readers come later; their own ask is drafted.";

    story.judge(ask.carry.id, carryHead, {
      at: t("2026-10-06T18:00"),
      heldBack: [held(EXPORT, 7, 7), held(PARSER, 4, 4)],
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.AwaitingDecision.make({
        decision: decisionId(11),
      }),
      stage: "human",
    });
    story.decision(
      decision({
        at: t("2026-10-06T18:00"),
        deciders: [people.ines],
        evidence: [
          {
            label: "answer",
            value: `${people.okafor} at ${carryHead} (push-${carryHead}-${people.okafor})`,
          },
          {
            label: "escape",
            value: `${carryAt.path}:${carryAt.line}: .todo( -- ${carryReason}`,
          },
        ],
        n: 11,
        subject: Subject.cases.Waiver.make({
          ask: ask.carry.id,
          at: carryAt,
          marker: ".todo(",
          reason: carryReason,
        }),
      })
    );

    const subsets = draftedFiles(
      "export-font-subsets",
      "export",
      "Export embeds only the font subsets a document uses."
    );

    story.propose(
      {
        files: subsets,
        proposal: proposal({
          at: t("2026-10-06T18:30"),
          draft: DraftState.cases.Failed.make({
            attempts: 1,
            model: "memory",
            refusal: "VerifierBlocked",
            round: 2,
          }),
          files: subsets.map(({ path }) => path),
          n: 4,
          proposer: people.okafor,
          want: "Export embeds only the font subsets a document uses.",
        }),
      },
      { at: t("2026-10-06T19:00"), ready: true }
    );
    story.drafted(proposalId(4), t("2026-10-06T20:00"), false);
    story.decision(
      decision({
        at: t("2026-10-06T20:00"),
        deciders: [people.okonkwo],
        evidence: [
          {
            label: "want",
            value: "Export embeds only the font subsets a document uses.",
          },
          { label: "territory", value: "@vellum/export" },
          ...subsets.map(({ content, path }) => ({
            label: path,
            value: content,
          })),
          {
            label: "draft failed",
            value:
              "The Checker was busy; the platform could not run the check this round.",
          },
        ],
        n: 12,
        subject: Subject.cases.OpenProposal.make({ proposal: proposalId(4) }),
      })
    );

    // October 7, this morning.
    story.claim(
      ask.exportErrors.id,
      people.tove,
      t("2026-10-07T07:00"),
      exportSuite
    );

    const errorsHead = story.push(ask.exportErrors.id, t("2026-10-07T07:30"));

    story.judge(ask.exportErrors.id, errorsHead, {
      at: t("2026-10-07T07:30"),
      lanes: allPassed("redThenGreen"),
      outcome: Outcome.cases.AwaitingDecision.make({
        decision: decisionId(13),
      }),
      stage: "human",
    });
    story.decision(
      decision({
        at: t("2026-10-07T07:30"),
        deciders: [people.okonkwo],
        evidence: [
          {
            label: "answer",
            value: `${people.tove} at ${errorsHead} (push-${errorsHead}-${people.tove})`,
          },
          { label: "item", value: token },
          {
            label: "where",
            value:
              "a file in the answer's tree holds the item's stored value; the answer is held aside",
          },
        ],
        n: 13,
        subject: Subject.cases.SecretInTree.make({
          ask: ask.exportErrors.id,
          item: token,
        }),
      })
    );
    story.decision(
      decision({
        at: t("2026-10-07T08:00"),
        deciders: [people.okonkwo],
        evidence: [
          { label: "handle", value: people.wren },
          {
            label: "line",
            value: `${people.wren} Asks to come back; proposals since are on topic.`,
          },
        ],
        n: 14,
        subject: Subject.cases.Vouch.make({ handle: people.wren }),
      })
    );

    story.push(ask.numbers.id, t("2026-10-07T08:15"));

    story.decide(decisionId(3), {
      at: t("2026-10-07T08:30"),
      by: people.ines,
      choice: "accept",
      note: "Clear want; tove's test covers the skip.",
    });
    story.accepted(proposalId(1));
    yield* story.open({
      asks: [ask.headings],
      at: t("2026-10-07T08:30"),
      by: people.ines,
      files: filesOf([ask.headings]),
    });
    story.claim(ask.headings.id, people.bram, t("2026-10-07T08:40"));
    story.release(ask.headings.id, t("2026-10-07T09:00"));

    story.decide(decisionId(11), {
      at: t("2026-10-07T09:10"),
      by: people.ines,
      choice: "accept",
      note: "EPUB 2 is out of scope here.",
    });
    yield* story.land(ask.carry.id, {
      at: t("2026-10-07T09:12"),
      changes: answerFiles(ask.carry, "export const endnotes = true;"),
      decidedBy: people.ines,
    });

    story.warn(tokenizer.child("render"), t("2026-10-07T09:30"));

    const lintHead = story.push(tokenizer.child("lint"), t("2026-10-07T09:40"));

    story.judge(tokenizer.child("lint"), lintHead, {
      at: t("2026-10-07T09:40"),
      lanes: { migrate: "passed", types: "passed" },
      outcome: Outcome.cases.Checking.make({ stage: "checks" }),
      stage: "checks",
    });

    story.propose({
      files: [],
      proposal: proposal({
        at: t("2026-10-07T09:50"),
        draft: DraftState.cases.Drafting.make({
          round: 1,
          startedAt: t("2026-10-07T09:50"),
        }),
        files: [],
        n: 5,
        proposer: people.lin,
        want: "The CLI prints a table of contents with --toc.",
      }),
    });

    const apart = {
      env: envAt(story.head(), t("2026-10-06T16:30")),
      ledger,
      working: [people.ines, people.okonkwo],
    };

    return { story, told: () => story.told(apart) };
  });

/**
 * The live landing: the first family's lint child, checking since this
 * morning, passes its last lanes and lands at `at`, one more of six.
 */
export const landLintChild = (story: Story, at: DateTime.Utc) =>
  Effect.gen(function* () {
    const child = tokenizer.child("lint");

    story.finishChecks(child, allPassed("migrate"));

    return yield* story.land(child, {
      at,
      changes: new Map([
        ["packages/lint/src/index.ts", entryOf("lint", "tokenize")],
      ]),
    });
  });
