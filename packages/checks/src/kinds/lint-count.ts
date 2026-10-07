/**
 * Lint counts: how many findings a project's own linter reports, read from
 * the JSON it prints (oxlint's `--format json` or ESLint's `--format json`),
 * per path, for one rule or all, within a territory. Pure: the linter runs
 * elsewhere, and this reads what it printed, exactly as it printed it.
 */
import type { Glob } from "@repo/protocol/domain/common";
import { RepoPath } from "@repo/protocol/ids";
import { Option, Order, Result, Schema } from "effect";

import { matchGlob } from "../judge.ts";

/** The JSON a linter prints: oxlint's report object, or ESLint's array of files. */
export type LintFormat = "oxlint" | "eslint";

/** A lint count: the findings in all, and per repo path (only paths with any). */
export interface LintCount {
  readonly total: number;
  readonly byPath: ReadonlyMap<RepoPath, number>;
}

/** How much of an unreadable output a `CountUnreadable` keeps. */
const HEAD_LENGTH = 200;

/**
 * A counter's output held no count the platform can read: not JSON, not the
 * shape its format prints, or no integer where a metric's path points. It
 * keeps the output's first 200 characters, so the answerer and the deciders
 * see what the command printed instead.
 */
export class CountUnreadable extends Schema.TaggedError<CountUnreadable>()(
  "CountUnreadable",
  { head: Schema.String }
) {
  static readonly of = (output: string) =>
    new CountUnreadable({ head: output.slice(0, HEAD_LENGTH) });
}

// `oxlint --format json`: one object; each diagnostic names its file and,
// unless it is a parse error or a directive report, its rule as
// `plugin(rule)`.
const OxlintReport = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.optionalKey(Schema.String),
      filename: Schema.NonEmptyString,
    })
  ),
});

// `eslint --format json`: one entry per file, each with its messages; a
// parse error or a directive report has a null `ruleId`.
const EslintReport = Schema.Array(
  Schema.Struct({
    filePath: Schema.NonEmptyString,
    messages: Schema.Array(
      Schema.Struct({
        ruleId: Schema.optionalKey(Schema.NullOr(Schema.String)),
      })
    ),
  })
);

/** One finding: the file it is in, and the rule that reported it, if one did. */
interface Finding {
  readonly path: string;
  readonly rule: Option.Option<string>;
}

const readOxlint = Schema.decodeOption(Schema.fromJsonString(OxlintReport));

const readEslint = Schema.decodeOption(Schema.fromJsonString(EslintReport));

const findingsOf = (
  output: string,
  format: LintFormat
): Option.Option<readonly Finding[]> =>
  format === "oxlint"
    ? Option.map(readOxlint(output), ({ diagnostics }) =>
        diagnostics.map(({ code, filename }) => ({
          path: filename,
          rule: Option.fromNullishOr(code),
        }))
      )
    : Option.map(readEslint(output), (files) =>
        files.flatMap(({ filePath, messages }) =>
          messages.map(({ ruleId }) => ({
            path: filePath,
            rule: Option.fromNullishOr(ruleId),
          }))
        )
      );

/**
 * A rule, as either tool or a maintainer writes it: oxlint's code form
 * `typescript(no-explicit-any)`, a config's `typescript/no-explicit-any`,
 * ESLint's `@typescript-eslint/no-explicit-any`, or a bare `no-debugger`.
 * `plugin` is `None` for a bare name.
 */
interface RuleName {
  readonly plugin: Option.Option<string>;
  readonly name: string;
}

// `plugin(rule)`, oxlint's code form.
const CODE_FORM = /^(?<plugin>[^()]+)\((?<name>[^()]+)\)$/u;

// The core rules' plugin: oxlint prints them as `eslint(no-debugger)`, ESLint
// as a bare `no-debugger`.
const CORE = "eslint";

// One plugin under the names the two tools and their configs use for it:
// `@typescript-eslint`, `typescript-eslint` and `typescript` are one plugin,
// and `eslint-plugin-unicorn` is `unicorn`.
const pluginOf = (written: string) => {
  const unscoped = written.replace(/^@/u, "").replace(/^eslint-plugin-/u, "");

  return unscoped === "typescript-eslint" ? "typescript" : unscoped;
};

const ruleNameOf = (written: string): RuleName => {
  const code = CODE_FORM.exec(written)?.groups;

  if (code?.plugin !== undefined && code.name !== undefined) {
    return { name: code.name, plugin: Option.some(pluginOf(code.plugin)) };
  }

  const slash = written.lastIndexOf("/");

  return slash === -1
    ? { name: written, plugin: Option.none() }
    : {
        name: written.slice(slash + 1),
        plugin: Option.some(pluginOf(written.slice(0, slash))),
      };
};

/**
 * Whether a finding's rule is the one asked for. A bare name asks for that
 * rule in any plugin (`no-explicit-any` counts typescript's); a finding's
 * bare name is a core rule. A finding with no rule (a file the linter could
 * not parse, an unused directive) is counted only when no rule is asked for.
 */
const isRule =
  (wanted: RuleName) =>
  (finding: Finding): boolean =>
    Option.match(finding.rule, {
      onNone: () => false,
      onSome: (written) => {
        const found = ruleNameOf(written);

        return (
          found.name === wanted.name &&
          Option.match(wanted.plugin, {
            onNone: () => true,
            onSome: (plugin) =>
              plugin === Option.getOrElse(found.plugin, () => CORE),
          })
        );
      },
    });

/** A path relative to the repo: without `root`'s prefix and any leading `./`. */
const repoPathOf = (path: string, root: Option.Option<string>): string => {
  const inside = Option.match(root, {
    onNone: () => path,
    onSome: (dir) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;

      return path.startsWith(prefix) && path.length > prefix.length
        ? path.slice(prefix.length)
        : path;
    },
  });

  return inside.replace(/^(?:\.\/)+(?=.)/u, "");
};

const EXCLUDE = "!";

/** Whether a path is in a territory: some glob matches it, and no `!` glob takes it back. */
const within = (territory: readonly Glob[], path: string) =>
  territory.some(
    (glob) => !glob.startsWith(EXCLUDE) && matchGlob(glob, path)
  ) &&
  !territory.some(
    (glob) =>
      glob.startsWith(EXCLUDE) && matchGlob(glob.slice(EXCLUDE.length), path)
  );

const totalOf = (byPath: ReadonlyMap<RepoPath, number>) =>
  [...byPath.values()].reduce((sum, count) => sum + count, 0);

/**
 * The part of a count inside a territory: the paths its globs match, with
 * `!` globs taking paths back out. One linter run counted once serves every
 * territory a ratchet keeps a baseline for.
 */
export const countWithin = (
  count: LintCount,
  territory: readonly Glob[]
): LintCount => {
  const byPath = new Map(
    [...count.byPath].filter(([path]) => within(territory, path))
  );

  return { byPath, total: totalOf(byPath) };
};

/** The format an output is in, by its JSON's shape: an array is ESLint's. */
const detect = (output: string): LintFormat =>
  output.trimStart().startsWith("[") ? "eslint" : "oxlint";

/**
 * Counts a linter's findings from its JSON output, per repo path. `rule`
 * keeps one rule's (in either tool's spelling); `territory` keeps the paths
 * its globs match (with `!` taking paths back out); `root` is stripped from
 * the front of each path, since ESLint prints absolute ones. The format is
 * read from the output when not given. Output it can't read, in the format
 * given or detected, is a `CountUnreadable`, never a thrown error.
 */
export const countLint = (input: {
  readonly output: string;
  readonly format?: LintFormat | undefined;
  readonly rule?: string | undefined;
  readonly territory?: readonly Glob[] | undefined;
  readonly root?: string | undefined;
}): Result.Result<LintCount, CountUnreadable> => {
  const root = Option.fromNullishOr(input.root);
  const wanted = Option.map(Option.fromNullishOr(input.rule), ruleNameOf);

  return Result.fromOption(
    findingsOf(input.output, input.format ?? detect(input.output)),
    () => CountUnreadable.of(input.output)
  ).pipe(
    Result.map((findings) => {
      const counts = new Map<RepoPath, number>();

      for (const finding of findings) {
        const counted = Option.match(wanted, {
          onNone: () => true,
          onSome: (rule) => isRule(rule)(finding),
        });

        if (counted) {
          const path = RepoPath.make(repoPathOf(finding.path, root));

          counts.set(path, (counts.get(path) ?? 0) + 1);
        }
      }

      const byPath = new Map(
        [...counts].toSorted(([one], [other]) => Order.String(one, other))
      );

      const count = { byPath, total: totalOf(byPath) };

      return input.territory === undefined
        ? count
        : countWithin(count, input.territory);
    })
  );
};
