// Ported from joelhooks/rat-stack@fba26d8 `scripts/oxlint-plugin-debt-ledger.ts`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
import { defineRule } from "@oxlint/plugins";

/** The baseline's keys: one per directive, so each kind is counted apart. */
type DebtKind =
  | "oxlint-disable"
  | "@effect-diagnostics"
  | "@ts-expect-error"
  | "@ts-ignore"
  | "@ts-nocheck";

/**
 * Each kind's directive. oxlint, eslint and tsc read a directive only where a
 * comment's line starts, so prose that names one mid-sentence is no escape.
 * The Effect language service reads its directive anywhere, so that one
 * counts anywhere in a comment.
 */
const debtPatterns = [
  {
    anywhere: false,
    kind: "oxlint-disable",
    // oxlint honours eslint's spelling of its directives too.
    pattern: /\b(?:oxlint|eslint)-disable(?:-[a-z-]+)?\b/gu,
  },
  {
    anywhere: true,
    kind: "@effect-diagnostics",
    pattern: /@effect-diagnostics(?:-next-line)?\b/gu,
  },
  {
    anywhere: false,
    kind: "@ts-expect-error",
    pattern: /@ts-expect-error\b/gu,
  },
  { anywhere: false, kind: "@ts-ignore", pattern: /@ts-ignore\b/gu },
  { anywhere: false, kind: "@ts-nocheck", pattern: /@ts-nocheck\b/gu },
] as const satisfies readonly {
  readonly anywhere: boolean;
  readonly kind: DebtKind;
  readonly pattern: RegExp;
}[];

/** What may come before a directive on a comment's line: space, `*` and `/`. */
const LINE_LEAD = /^[\s*/]*$/u;

/** The ` -- ` that starts a reason, or a bare ` --` at the line's end. */
const REASON_MARK = /\s--(?=\s|$)/u;

/**
 * Reports every escape directive in a comment, once, as JSON:
 * `{column, directive, kind, line, reason?}`. The reason is the text after
 * ` -- ` on the directive's own line.
 *
 * Each report sits at the file's first offset and carries its real line in
 * the message. No disable comment covers offset 0 (oxlint 1.87, held by the
 * fixture in `packages/config/test/debt.test.ts`), so a file-wide
 * `oxlint-disable` or an `oxlint-disable-line` can't hide an escape from the
 * count.
 */
export const debtLedger = defineRule({
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") {
            continue;
          }

          for (const { anywhere, kind, pattern } of debtPatterns) {
            for (const match of comment.value.matchAll(pattern)) {
              const index = match.index ?? 0;
              const lineStart = comment.value.lastIndexOf("\n", index) + 1;

              if (
                !anywhere &&
                !LINE_LEAD.test(comment.value.slice(lineStart, index))
              ) {
                continue;
              }

              const text =
                comment.value.slice(index).split(/\r?\n/u, 1)[0]?.trimEnd() ??
                "";

              const mark = REASON_MARK.exec(text);

              const directive = (
                mark === null ? text : text.slice(0, mark.index)
              ).trim();

              const reason =
                mark === null
                  ? ""
                  : text.slice(mark.index + mark[0].length).trim();

              const { column, line } = context.sourceCode.getLocFromIndex(
                comment.start + 2 + index
              );

              context.report({
                loc: context.sourceCode.getLocFromIndex(0),
                message: JSON.stringify({
                  column,
                  directive,
                  kind,
                  line,
                  reason: reason === "" ? undefined : reason,
                }),
              });
            }
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Report source-comment directives for the debt ledger.",
    },
    messages: {},
    type: "problem",
  },
});
