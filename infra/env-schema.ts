/**
 * What infra reads from one of our own Workers' `.env.schema` files: each
 * item's name, and whether it must have a value. Never a value: the schema
 * holds none for a secret, and the files that do (`.env`, `.env.local`) stay
 * closed (AGENTS.md "Boundaries: Env").
 *
 * The rules are @env-spec's, as far as our schemas use them: decorators sit in
 * `#` comment lines, the header's end at `# ---`; an item's own comments
 * directly precede its `NAME=` line; `@required` and `@optional` decide, and
 * otherwise the header's `@defaultRequired` does (`infer`: required when the
 * schema gives a value). A conditional `@required=forEnv(…)` counts as
 * optional here. ASSUMPTION: a schema with no `@defaultRequired` infers, as
 * every schema in this repo says outright.
 */

/** One item of a `.env.schema`. */
export interface SchemaItem {
  readonly name: string;
  readonly required: boolean;
}

const ITEM = /^(?<name>[A-Za-z_]\w*)=(?<value>.*)$/u;

/** The `@` decorators in one comment line. */
const decoratorsOf = (line: string) =>
  line
    .replace(/^#/u, "")
    .split(/\s+/u)
    .filter((word) => word.startsWith("@"));

type Default = "infer" | "true" | "false";

const defaultOf = (header: readonly string[]): Default => {
  const setting = header
    .find((decorator) => decorator.startsWith("@defaultRequired="))
    ?.slice("@defaultRequired=".length);

  return setting === "true" || setting === "false" ? setting : "infer";
};

const isRequired = (
  decorators: readonly string[],
  fallback: Default,
  value: string
) => {
  if (decorators.includes("@required")) {
    return true;
  }

  if (
    decorators.includes("@optional") ||
    decorators.some((decorator) => decorator.startsWith("@required="))
  ) {
    return false;
  }

  return fallback === "infer" ? value.trim() !== "" : fallback === "true";
};

/** Every item `text` declares, in order. */
export const schemaItems = (text: string): readonly SchemaItem[] => {
  const lines = text.split(/\r?\n/u).map((line) => line.trim());
  const divider = lines.findIndex((line) => /^#\s*-{3,}$/u.test(line));
  const header = lines.slice(0, Math.max(divider, 0)).flatMap(decoratorsOf);
  const fallback = defaultOf(header);
  const items: SchemaItem[] = [];
  // The decorators of the comment lines since the last blank line or item.
  const pending: string[] = [];

  for (const line of lines.slice(divider + 1)) {
    const item = ITEM.exec(line)?.groups;

    if (line.startsWith("#")) {
      pending.push(...decoratorsOf(line));
    } else {
      if (item?.name !== undefined) {
        items.push({
          name: item.name,
          required: isRequired(pending, fallback, item.value ?? ""),
        });
      }

      pending.length = 0;
    }
  }

  return items;
};
