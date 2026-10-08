/**
 * The answer's diff, where a `Finish` decision carries it: the evidence
 * entry labelled `patch`, a unified diff (`git diff <base> <head>`). No other
 * decision carries one (spec §2.3 `Decision.evidence`: "never a diff unless
 * the kind allows a finish"), and the web never fetches one another way.
 */
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { Array as Arr, Option } from "effect";

/** The evidence label a `Finish` decision's diff travels under. */
export const PATCH_LABEL = "patch";

/** The evidence label naming the answer's fork, the repo a finish fetches from and pushes to. */
export const FORK_LABEL = "fork";

/** The diff a `Finish` decision carries, if it carries one; never another subject's. */
export const patchOf = (decision: Decision): Option.Option<string> =>
  DecisionSubject.isAnyOf(["Finish"])(decision.subject)
    ? Option.map(
        Arr.findFirst(decision.evidence, ({ label }) => label === PATCH_LABEL),
        ({ value }) => value
      ).pipe(Option.filter((patch) => patch.trim().length > 0))
    : Option.none();

const NEW_FILE = /^\+\+\+ (?:b\/)?(?<path>.+)$/u;

const OLD_FILE = /^--- (?:a\/)?(?<path>.+)$/u;

const RENAMED = /^rename to (?<path>.+)$/u;

const HEADER = /^diff --git a\/.+ b\/(?<path>.+)$/u;

/** One file's block of a unified diff: the path it ends up at (or the path it leaves). */
const pathOf = (block: readonly string[]): Option.Option<string> => {
  const first = (pattern: RegExp) =>
    Arr.findFirst(block, (line) => pattern.test(line)).pipe(
      Option.flatMap((line) =>
        Option.fromNullishOr(pattern.exec(line)?.groups?.path)
      )
    );

  const added = first(NEW_FILE).pipe(
    Option.filter((path) => path !== "/dev/null")
  );

  return added.pipe(
    Option.orElse(() =>
      first(OLD_FILE).pipe(Option.filter((path) => path !== "/dev/null"))
    ),
    Option.orElse(() => first(RENAMED)),
    Option.orElse(() => first(HEADER))
  );
};

/**
 * The files a unified diff changes, in its order: each `diff --git` block's
 * new path (its old path when the file is deleted). A diff without git's
 * headers counts as one block per `---`/`+++` pair.
 */
export const changedFiles = (patch: string): readonly string[] => {
  const lines = patch.split("\n");
  const gitHeaders = lines.some((line) => HEADER.test(line));

  const starts = (line: string, next: string | undefined) =>
    gitHeaders
      ? line.startsWith("diff --git ")
      : OLD_FILE.test(line) && next !== undefined && NEW_FILE.test(next);

  const blocks: string[][] = [];

  for (const [index, line] of lines.entries()) {
    if (starts(line, lines[index + 1])) {
      blocks.push([line]);
    } else {
      blocks.at(-1)?.push(line);
    }
  }

  return Arr.dedupe(blocks.flatMap((block) => Option.toArray(pathOf(block))));
};
