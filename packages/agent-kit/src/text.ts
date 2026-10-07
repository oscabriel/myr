/**
 * The few ways generated text is written: Markdown pages, code spans and
 * table cells that survive any command a project writes, and JSON with
 * sorted keys, so no byte depends on the order a value was built in.
 */
import { Array as Arr, Order, Predicate } from "effect";
import type { Schema } from "effect";

/** A Markdown page: its lines joined, ending in exactly one newline. */
export const page = (lines: readonly string[]) =>
  `${lines.join("\n").replace(/\n+$/u, "")}\n`;

/**
 * A code span around any text: a command with a backtick in it gets a
 * longer fence, padded with spaces as Markdown asks.
 */
export const code = (text: string) => {
  const runs = text.match(/`+/gu) ?? [];
  const longest = Math.max(0, ...runs.map((run) => run.length));
  const fence = "`".repeat(longest + 1);

  return longest === 0
    ? `${fence}${text}${fence}`
    : `${fence} ${text} ${fence}`;
};

/** A table cell: a pipe in it would end the cell. */
export const cell = (text: string) => text.replaceAll("|", String.raw`\|`);

/** A Markdown table: a header row, its rule, then one row per entry. */
export const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[]
) => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
];

/** Words joined as a sentence lists them: `a`, `a and b`, `a, b and c`. */
export const listed = (words: readonly string[]) =>
  words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;

const byKey = Order.mapInput(
  Order.String,
  ([key]: readonly [string, Schema.Json]) => key
);

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

const sortKeys = (value: Schema.Json): Schema.Json => {
  if (isJsonArray(value)) {
    return value.map(sortKeys);
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Arr.sort(Object.entries(value), byKey).map(([key, item]) => [
        key,
        sortKeys(item),
      ])
    );
  }

  return value;
};

/** JSON as the generators write it: sorted keys, two-space indents, a final newline. */
export const printJson = (value: Schema.Json) =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;
