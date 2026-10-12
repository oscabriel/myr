import type { Glob } from "@repo/protocol/domain/common";
import { RepoPath } from "@repo/protocol/ids";
import { Option, Order, Result, Schema } from "effect";

import { matchGlob } from "../judge.ts";

export type LintFormat = "oxlint" | "eslint";

export interface LintCount {
  readonly total: number;
  readonly byPath: ReadonlyMap<RepoPath, number>;
}

const HEAD_LENGTH = 200;

export class CountUnreadable extends Schema.TaggedError<CountUnreadable>()(
  "CountUnreadable",
  { head: Schema.String }
) {
  static readonly of = (output: string) =>
    new CountUnreadable({ head: output.slice(0, HEAD_LENGTH) });
}

// A parse error or directive report carries no rule.
const OxlintReport = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.optionalKey(Schema.String),
      filename: Schema.NonEmptyString,
    })
  ),
});

// A parse error or directive report has a null `ruleId`.
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

interface RuleName {
  readonly plugin: Option.Option<string>;
  readonly name: string;
}

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

// A bare name asks for that rule in any plugin; a finding with no rule is
// counted only when no rule is asked for.
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

export const countWithin = (
  count: LintCount,
  territory: readonly Glob[]
): LintCount => {
  const byPath = new Map(
    [...count.byPath].filter(([path]) => within(territory, path))
  );

  return { byPath, total: totalOf(byPath) };
};

const detect = (output: string): LintFormat =>
  output.trimStart().startsWith("[") ? "eslint" : "oxlint";

// `root` is stripped since ESLint prints absolute paths.
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
