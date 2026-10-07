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

const debtPatterns = [
  { kind: "oxlint-disable", pattern: /\boxlint-disable(?:-[a-z-]+)?\b/gu },
  {
    kind: "@effect-diagnostics",
    pattern: /@effect-diagnostics(?:-next-line)?\b/gu,
  },
  { kind: "@ts-expect-error", pattern: /@ts-expect-error\b/gu },
  { kind: "@ts-ignore", pattern: /@ts-ignore\b/gu },
  { kind: "@ts-nocheck", pattern: /@ts-nocheck\b/gu },
] as const satisfies readonly {
  readonly kind: DebtKind;
  readonly pattern: RegExp;
}[];

/**
 * Reports every escape directive in a comment, once, as JSON:
 * `{directive, kind, reason?}`. The reason is the text after ` -- `.
 */
export const debtLedger = defineRule({
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") {
            continue;
          }

          for (const { kind, pattern } of debtPatterns) {
            for (const match of comment.value.matchAll(pattern)) {
              const index = match.index ?? 0;

              const line = comment.value
                .slice(index)
                .split(/\r?\n/u, 1)[0]
                ?.replace(/^\*+\s*/u, "")
                .trim();

              if (line === undefined) {
                continue;
              }

              const reason = /\s--\s*(?<reason>.*)$/u
                .exec(line)
                ?.groups?.reason?.trim();

              const directive = line.split(" -- ", 1)[0]?.trim() ?? line;

              context.report({
                loc: context.sourceCode.getLocFromIndex(
                  comment.start + 2 + index
                ),
                message: JSON.stringify({
                  directive,
                  kind,
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
