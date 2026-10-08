/**
 * The parser seam's adapter over `@env-spec/parser` 0.6.1 (MIT; varlock's
 * format), pinned exactly: its API is 0.x. It reads the text into
 * plain data and nothing else. The parser's own expansion only rewrites
 * syntax (`$APP_ENV` becomes the call `ref(APP_ENV)`, `$(…)` the call
 * `exec(…)`); nothing here runs a call, loads a `@plugin` or follows an
 * `@import`, and this module imports nothing that could.
 *
 * A static `undefined` (`@sensitive=undefined`, `KEY=undefined`) is read as
 * absent, which is what varlock makes of it: a flag so set leaves the
 * default in place.
 */
import {
  ParsedEnvSpecFunctionArgs,
  ParsedEnvSpecFunctionCall,
  ParsedEnvSpecKeyValuePair,
  ParsedEnvSpecObjectLiteral,
  ParsedEnvSpecStaticValue,
  parseEnvSpecDotEnvFile,
} from "@env-spec/parser";
import type {
  ParsedEnvSpecConfigItem,
  ParsedEnvSpecDecorator,
  ParsedEnvSpecArrayLiteral,
} from "@env-spec/parser";
import type { RepoPath } from "@repo/protocol/ids";
import { Array, Effect, Layer, Option, Predicate, Schema } from "effect";
import type { Types } from "effect";

import {
  EnvSchemaParser,
  EnvSchemaUnreadable,
  withImports,
} from "../env-schema.ts";
import type {
  ParsedArgs,
  ParsedDecorator,
  ParsedItem,
  ParsedNamedArg,
  ParsedValue,
} from "../env-schema.ts";

/** A value node of the parser's tree. */
type ValueNode =
  | ParsedEnvSpecArrayLiteral
  | ParsedEnvSpecFunctionArgs
  | ParsedEnvSpecFunctionCall
  | ParsedEnvSpecObjectLiteral
  | ParsedEnvSpecStaticValue;

/** A static value: text, a number, a flag, or none for `undefined`. */
const staticOf = (
  node: ParsedEnvSpecStaticValue
): Option.Option<ParsedValue> => {
  const value: unknown = node.value;

  return Predicate.isString(value) ||
    Predicate.isNumber(value) ||
    Predicate.isBoolean(value)
    ? Option.some(value)
    : Option.none();
};

/** A node as plain data, never evaluated; none for a static `undefined`. */
const valueOf = (node: ValueNode): Option.Option<ParsedValue> => {
  /** Arguments as written: the positional ones, then the `key=value` ones. */
  const argsOf = (
    values: readonly (
      | ParsedEnvSpecFunctionCall
      | ParsedEnvSpecKeyValuePair
      | ParsedEnvSpecStaticValue
    )[]
  ): ParsedArgs => ({
    named: Array.getSomes(
      values.map((each): Option.Option<ParsedNamedArg> =>
        each instanceof ParsedEnvSpecKeyValuePair
          ? Option.map(valueOf(each.value), (value) => ({
              key: each.key,
              value,
            }))
          : Option.none()
      )
    ),
    positional: Array.getSomes(
      values.map((each) =>
        each instanceof ParsedEnvSpecKeyValuePair
          ? Option.none()
          : valueOf(each)
      )
    ),
  });

  if (node instanceof ParsedEnvSpecStaticValue) {
    return staticOf(node);
  }

  if (node instanceof ParsedEnvSpecFunctionCall) {
    return Option.some({
      fn: node.name,
      text: node.toString(),
      ...argsOf(node.data.args.values),
    });
  }

  if (
    node instanceof ParsedEnvSpecFunctionArgs ||
    node instanceof ParsedEnvSpecObjectLiteral
  ) {
    return Option.some(argsOf(node.values));
  }

  return Option.some(Array.getSomes(node.values.map(valueOf)));
};

/** The decorators as written, but those set to `undefined`. */
const decoratorsOf = (
  decorators: readonly ParsedEnvSpecDecorator[]
): readonly ParsedDecorator[] =>
  Array.getSomes(
    decorators.map(({ name, value }) =>
      Option.map(
        value === undefined ? Option.none() : valueOf(value),
        (each) => ({ name, value: each })
      )
    )
  );

/** The text of an item's value, if it has one: `KEY=` and `KEY=undefined` have none. */
const valueTextOf = (item: ParsedEnvSpecConfigItem): Option.Option<string> => {
  const { value } = item;

  if (value === undefined) {
    return Option.none();
  }

  return value instanceof ParsedEnvSpecStaticValue
    ? Option.map(staticOf(value), String)
    : Option.some(value.toString());
};

/** One item: its key, its description comment, its decorators, its value's text. */
const itemOf = (item: ParsedEnvSpecConfigItem): ParsedItem => {
  const parsed: Types.Mutable<ParsedItem> = {
    decorators: decoratorsOf(item.decoratorsArray),
    key: item.key,
  };

  const value = valueTextOf(item);

  if (item.description !== "") {
    parsed.description = item.description;
  }

  if (Option.isSome(value)) {
    parsed.value = value.value;
  }

  return parsed;
};

/** Where the parser stopped, as its syntax errors carry it. */
const Stopped = Schema.Struct({
  location: Schema.Struct({
    start: Schema.Struct({ column: Schema.Int, line: Schema.Int }),
  }),
});

/** Why a text is not a schema: where it stops parsing, never the text itself. */
const unreadable = (file: RepoPath, cause: unknown) =>
  new EnvSchemaUnreadable({
    file,
    reason: Option.match(Schema.decodeUnknownOption(Stopped)(cause), {
      onNone: () => "does not parse as @env-spec",
      onSome: ({ location: { start } }) =>
        `does not parse as @env-spec at line ${start.line}, column ${start.column}`,
    }),
  });

export const EnvSchemaParserEnvSpec: Layer.Layer<EnvSchemaParser> =
  Layer.succeed(EnvSchemaParser, {
    parse: (file, text) =>
      Effect.try({
        catch: (cause) => unreadable(file, cause),
        try: () => {
          const parsed = parseEnvSpecDotEnvFile(text);

          return {
            header: decoratorsOf(parsed.decoratorsArray),
            items: parsed.configItems.map(itemOf),
          };
        },
      }).pipe(Effect.flatMap((parsed) => withImports(file, parsed))),
  });
