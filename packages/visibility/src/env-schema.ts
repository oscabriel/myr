// Parsing reads text and nothing else: no value expression is evaluated, no
// plugin is loaded, and no import outside the repo is followed.
import { RepoPath } from "@repo/protocol/ids";
import { Array, Context, Effect, Predicate, Result, Schema } from "effect";

/** Never evaluated; a `$APP_ENV` reference arrives as the call `ref(APP_ENV)`. */
export type ParsedValue =
  | string
  | number
  | boolean
  | readonly ParsedValue[]
  | ParsedCall
  | ParsedArgs;

export interface ParsedNamedArg {
  readonly key: string;
  readonly value: ParsedValue;
}

export interface ParsedArgs {
  readonly positional: readonly ParsedValue[];
  readonly named: readonly ParsedNamedArg[];
}

export interface ParsedCall extends ParsedArgs {
  readonly fn: string;
  readonly text: string;
}

export interface ParsedDecorator {
  readonly name: string;
  readonly value: ParsedValue;
}

export interface ParsedItem {
  readonly key: string;
  readonly description?: string;
  readonly decorators: readonly ParsedDecorator[];
  readonly value?: string;
}

export interface ParsedEnvSchema {
  readonly header: readonly ParsedDecorator[];
  readonly items: readonly ParsedItem[];
  readonly imports: readonly string[];
}

/** Names the file and why, never a value. */
export class EnvSchemaUnreadable extends Schema.TaggedError<EnvSchemaUnreadable>()(
  "EnvSchemaUnreadable",
  { file: RepoPath, reason: Schema.String }
) {}

export class EnvSchemaParser extends Context.Service<
  EnvSchemaParser,
  {
    readonly parse: (
      file: RepoPath,
      text: string
    ) => Effect.Effect<ParsedEnvSchema, EnvSchemaUnreadable>;
  }
>()("visibility/EnvSchemaParser") {}

export const isCall = (value: ParsedValue): value is ParsedCall =>
  Predicate.hasProperty(value, "fn");

export const isArgs = (value: ParsedValue): value is ParsedArgs =>
  Predicate.hasProperty(value, "named") && !isCall(value);

export const isList = (value: ParsedValue): value is readonly ParsedValue[] =>
  Array.isArray(value);

const OUTSIDE = /^(?:~|[/\\]|[A-Za-z][\w+.-]*:)/u;

const repoImport = (
  file: RepoPath,
  written: string
): Result.Result<RepoPath, string> => {
  if (written === "") {
    return Result.fail("an @import names no path");
  }

  if (OUTSIDE.test(written)) {
    return Result.fail(`imports ${written}, outside the repo`);
  }

  const folder: string[] = file.split("/").slice(0, -1);

  for (const segment of written.split(/[/\\]/u)) {
    if (segment === "..") {
      if (folder.pop() === undefined) {
        return Result.fail(`imports ${written}, above the repo's root`);
      }
    } else if (segment !== "" && segment !== ".") {
      folder.push(segment);
    }
  }

  const path = folder.join("/") || ".";

  return Result.succeed(
    RepoPath.make(written.endsWith("/") && path !== "." ? `${path}/` : path)
  );
};

/**
 * An import from outside the repo makes the schema unreadable: the platform
 * never follows one. Both parsers end here, so the rule is the same whichever
 * reads the text.
 */
export const withImports = (
  file: RepoPath,
  parsed: Pick<ParsedEnvSchema, "header" | "items">
): Effect.Effect<ParsedEnvSchema, EnvSchemaUnreadable> =>
  Effect.forEach(
    parsed.header.filter(({ name }) => name === "import"),
    ({ value }) => {
      const written = isArgs(value) ? value.positional[0] : undefined;

      return Effect.fromResult(
        Predicate.isString(written)
          ? repoImport(file, written)
          : Result.fail("an @import names no path")
      ).pipe(
        Effect.mapError((reason) => new EnvSchemaUnreadable({ file, reason }))
      );
    }
  ).pipe(
    Effect.map((imports) => ({
      header: parsed.header,
      imports,
      items: parsed.items,
    }))
  );
