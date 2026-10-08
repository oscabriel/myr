/**
 * The parser seam (VL §8.3): the one place a project's `.env.schema` is
 * parsed, at a landed SHA. `@env-spec/parser` is reached only through an
 * adapter of this port (`./env-schema/env-spec`, issue 603), with a fake
 * beside it (`./env-schema/memory`). Parsing reads text and nothing else: no
 * value expression is evaluated, no plugin is loaded, and no import outside
 * the repo is followed.
 */
import { RepoPath } from "@repo/protocol/ids";
import { Array, Context, Effect, Predicate, Result, Schema } from "effect";

/**
 * A decorator's value as the schema writes it, never evaluated: text or a
 * number (`infer`, `sentry.io`), a flag (a bare `@required` is `true`), a
 * list (`[APP_ENV]`), a function call (`forEnv(production)`; a `$APP_ENV`
 * reference arrives as the call `ref(APP_ENV)`), or arguments alone (a bare
 * call's, `@proxy(domain="sentry.io")`, or an object's, `{preventLeaks=false}`).
 */
export type ParsedValue =
  | string
  | number
  | boolean
  | readonly ParsedValue[]
  | ParsedCall
  | ParsedArgs;

/** One `key=value` argument. */
export interface ParsedNamedArg {
  readonly key: string;
  readonly value: ParsedValue;
}

/** Arguments as written: the positional ones, then the `key=value` ones. */
export interface ParsedArgs {
  readonly positional: readonly ParsedValue[];
  readonly named: readonly ParsedNamedArg[];
}

/** A function call, never run, and its text as written: `enum(development, test)`. */
export interface ParsedCall extends ParsedArgs {
  readonly fn: string;
  readonly text: string;
}

/** One decorator: `@sensitive`, `@type=string(minLength=32)`, `@import(../shared/)`. */
export interface ParsedDecorator {
  readonly name: string;
  readonly value: ParsedValue;
}

/** One item: its key, its description comment, its decorators, and its value text if it has one. */
export interface ParsedItem {
  readonly key: string;
  readonly description?: string;
  readonly decorators: readonly ParsedDecorator[];
  readonly value?: string;
}

/**
 * A `.env.schema`, parsed: the header's decorators (above its `# ---`),
 * every item in order, and the files its `@import`s name, recorded and
 * never merged.
 */
export interface ParsedEnvSchema {
  readonly header: readonly ParsedDecorator[];
  readonly items: readonly ParsedItem[];
  readonly imports: readonly string[];
}

/**
 * A `.env.schema` that cannot be read as one: it does not parse, or it
 * imports from outside the repo. Names the file and why, never a value.
 */
export class EnvSchemaUnreadable extends Schema.TaggedError<EnvSchemaUnreadable>()(
  "EnvSchemaUnreadable",
  { file: RepoPath, reason: Schema.String }
) {}

/** Parses a `.env.schema`'s text; reads nothing else. */
export class EnvSchemaParser extends Context.Service<
  EnvSchemaParser,
  {
    readonly parse: (
      file: RepoPath,
      text: string
    ) => Effect.Effect<ParsedEnvSchema, EnvSchemaUnreadable>;
  }
>()("visibility/EnvSchemaParser") {}

/** Whether a value is a function call as written (`forEnv(production)`). */
export const isCall = (value: ParsedValue): value is ParsedCall =>
  Predicate.hasProperty(value, "fn");

/** Whether a value is arguments alone: a bare call's or an object's. */
export const isArgs = (value: ParsedValue): value is ParsedArgs =>
  Predicate.hasProperty(value, "named") && !isCall(value);

/** Whether a value is a list as written (`[GET, POST]`). */
export const isList = (value: ParsedValue): value is readonly ParsedValue[] =>
  Array.isArray(value);

/** A path that starts outside any repo: the home folder, the root, a drive or a scheme (`C:`, `https:`). */
const OUTSIDE = /^(?:~|[/\\]|[A-Za-z][\w+.-]*:)/u;

/**
 * The repo path an `@import` names, resolved from the folder of the schema
 * that imports it; a reason when it names a place outside the repo. A
 * folder import (`../shared/`) keeps its trailing `/`.
 */
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
 * A parsed schema with the files its header's `@import`s name, as repo
 * paths, recorded and never merged. An import from outside the repo
 * (`~/…`, an absolute path, above the repo's root) makes the schema
 * unreadable: the platform never follows one. Both parsers end here, so
 * the rule is the same whichever reads the text.
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
