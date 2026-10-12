import type { Schema } from "effect";

import type { RepoFile } from "../../../src/finder.ts";

const file = (path: string, ...lines: readonly string[]): RepoFile => ({
  content: `${lines.join("\n")}\n`,
  path,
});

const manifest = (path: string, fields: Schema.JsonObject) =>
  file(path, JSON.stringify(fields, undefined, 2));

export const weakCheck = file(
  "checks/weak.test.ts",
  'import { expect, test } from "bun:test";',
  "",
  'import { parse } from "../packages/dates/src/index.ts";',
  "",
  'test("parse is there", () => {',
  "  expect(parse).toBeDefined();",
  "});"
);

export const strongCheck = file(
  "checks/strong.test.ts",
  'import { expect, test } from "bun:test";',
  "",
  'import { parse } from "../packages/dates/src/index.ts";',
  "",
  'test("parse reads a calendar day", () => {',
  '  expect(parse("2026-10-06")).toStrictEqual({ day: 6, month: 10, year: 2026 });',
  "});"
);

export const weakNewCheck = file(
  "checks/week-weak.test.ts",
  'import { expect, test } from "bun:test";',
  "",
  'import { weekOf } from "../packages/dates/src/index.ts";',
  "",
  'test("weekOf is there", () => {',
  "  expect(weekOf).toBeDefined();",
  "});"
);

export const strongNewCheck = file(
  "checks/week-strong.test.ts",
  'import { expect, test } from "bun:test";',
  "",
  'import { parse, weekOf } from "../packages/dates/src/index.ts";',
  "",
  'test("weekOf reads the ISO week of a day", () => {',
  '  expect(weekOf(parse("2026-10-06"))).toBe(41);',
  "});"
);

const datesIndex = [
  "/** Dates: read and show calendar days. */",
  'import type { Parsed } from "./parse.ts";',
  "",
  'export { Clock, type Instant } from "./clock.ts";',
  'export { parse, type Parsed } from "./parse.ts";',
  "",
  'const pad = (value: number): string => String(value).padStart(2, "0");',
  "",
  "/** A day as `YYYY-MM-DD`. */",
] as const;

const parseHead = [
  "/** Reading `YYYY-MM-DD` text. */",
  "export interface Parsed {",
  "  readonly year: number;",
  "  readonly month: number;",
  "  readonly day: number;",
  "}",
  "",
  "const ISO_DAY = /^(\\d{4})-(\\d{2})-(\\d{2})$/u;",
  "",
  "function digits(text: string | undefined): number {",
  '  return Number(text ?? "0");',
  "}",
  "",
  "/** The calendar day `text` names; throws on text that names none. */",
] as const;

const clockHead = [
  "/** Milliseconds since the epoch. */",
  "export type Instant = number;",
  "",
  "/** A clock that stands still, for tests and replays. */",
  "export class Clock {",
  "  readonly #start: Instant;",
  "",
  "  constructor(start: Instant) {",
  "    this.#start = start;",
  "  }",
  "",
] as const;

export const datesRepo: readonly RepoFile[] = [
  manifest("package.json", {
    name: "dates-repo",
    private: true,
    workspaces: ["packages/*"],
  }),
  manifest("tsconfig.json", {
    compilerOptions: {
      allowImportingTsExtensions: true,
      lib: ["ES2023"],
      module: "Preserve",
      moduleResolution: "bundler",
      noEmit: true,
      strict: true,
      target: "ES2023",
      types: [],
      verbatimModuleSyntax: true,
    },
    include: ["packages/*/src"],
  }),
  manifest("packages/dates/package.json", {
    exports: { ".": "./src/index.ts" },
    name: "@dates/dates",
    type: "module",
  }),
  file(
    "packages/dates/src/index.ts",
    ...datesIndex,
    "export const format = (day: Parsed): string =>",
    '  [String(day.year), pad(day.month), pad(day.day)].join("-");'
  ),
  file(
    "packages/dates/src/parse.ts",
    ...parseHead,
    "export function parse(text: string): Parsed {",
    "  const match = ISO_DAY.exec(text);",
    "",
    "  if (match === null) {",
    '    throw new RangeError("not a day");',
    "  }",
    "",
    "  return { day: digits(match[3]), month: digits(match[2]), year: digits(match[1]) };",
    "}"
  ),
  file(
    "packages/dates/src/clock.ts",
    ...clockHead,
    "  static at(start: Instant): Clock {",
    "    return new Clock(start);",
    "  }",
    "",
    "  get iso(): string {",
    "    return new Date(this.#start).toISOString();",
    "  }",
    "",
    "  now(): Instant {",
    "    return this.#start;",
    "  }",
    "}"
  ),
  manifest("packages/notes/package.json", {
    exports: { ".": "./src/index.ts" },
    name: "@dates/notes",
    type: "module",
  }),
  file(
    "packages/notes/src/index.ts",
    "/** A note's text without the space around it. */",
    "export const note = (text: string): string => text.trim();"
  ),
  weakCheck,
  strongCheck,
];

export const nullDates: readonly RepoFile[] = [
  file(
    "packages/dates/src/index.ts",
    ...datesIndex,
    "export const format = (day: Parsed): string =>",
    "  undefined as never;"
  ),
  file(
    "packages/dates/src/parse.ts",
    ...parseHead,
    "export function parse(text: string): Parsed { return undefined as never; }"
  ),
  file(
    "packages/dates/src/clock.ts",
    ...clockHead,
    "  static at(start: Instant): Clock { return undefined as never; }",
    "",
    "  get iso(): string { return undefined as never; }",
    "",
    "  now(): Instant { return undefined as never; }",
    "}"
  ),
];
