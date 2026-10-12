import { Array as Arr, Order, Predicate } from "effect";
import type { Schema } from "effect";

export const page = (lines: readonly string[]) =>
  `${lines.join("\n").replace(/\n+$/u, "")}\n`;

export const code = (text: string) => {
  const runs = text.match(/`+/gu) ?? [];
  const longest = Math.max(0, ...runs.map((run) => run.length));
  const fence = "`".repeat(longest + 1);

  return longest === 0
    ? `${fence}${text}${fence}`
    : `${fence} ${text} ${fence}`;
};

export const cell = (text: string) => text.replaceAll("|", String.raw`\|`);

export const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[]
) => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
];

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

export const printJson = (value: Schema.Json) =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;
