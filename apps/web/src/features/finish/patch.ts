/**
 * The answer's diff, where a `Finish` decision carries it: the evidence
 * entry labelled `patch`, a unified diff (`git diff <base> <head>`). No other
 * decision carries one (`Decision.evidence` holds no diff unless
 * the kind allows a finish), and the web never fetches one another way.
 */
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { Array as Arr, Option } from "effect";

/** The evidence label a `Finish` decision's diff travels under. */
export const PATCH_LABEL = "patch";

/** The evidence label naming the answer's fork, the repo a finish fetches from and pushes to. */
export const FORK_LABEL = "fork";

/** A decision whose subject is a finish. */
export type FinishDecision = Decision & {
  readonly subject: Extract<DecisionSubject, { readonly _tag: "Finish" }>;
};

const finishes = DecisionSubject.isAnyOf(["Finish"]);

/** Whether a decision is a finish: the one subject whose page shows a diff. */
export const isFinishDecision = (
  decision: Decision
): decision is FinishDecision => finishes(decision.subject);

/** The diff a `Finish` decision carries, if it carries one; never another subject's. */
export const patchOf = (decision: Decision): Option.Option<string> =>
  isFinishDecision(decision)
    ? Option.map(
        Arr.findFirst(decision.evidence, ({ label }) => label === PATCH_LABEL),
        ({ value }) => value
      ).pipe(Option.filter((patch) => patch.trim().length > 0))
    : Option.none();

// git ends a `---`/`+++` line with a tab when its path holds a space, and
// `diff -u` puts its timestamp after one: the path stops at the tab.
const NEW_FILE = /^\+\+\+ (?:b\/)?(?<path>[^\t]+)(?:\t.*)?$/u;

const OLD_FILE = /^--- (?:a\/)?(?<path>[^\t]+)(?:\t.*)?$/u;

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

/** The text of each file's block of a unified diff, by the path it ends up at. */
export const fileBlocks = (patch: string): ReadonlyMap<string, string> => {
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

  return new Map(
    blocks.flatMap((block) =>
      Option.toArray(
        Option.map(pathOf(block), (path) => [path, block.join("\n")] as const)
      )
    )
  );
};

/**
 * The files a unified diff changes, in its order: each `diff --git` block's
 * new path (its old path when the file is deleted). A diff without git's
 * headers counts as one block per `---`/`+++` pair.
 */
export const changedFiles = (patch: string): readonly string[] => [
  ...fileBlocks(patch).keys(),
];

/**
 * A short, stable id for one file's change: a polynomial hash over its
 * block of the diff, kept under a 32-bit prime. A new head that changes
 * the file changes its id, so whatever was kept against the old one no
 * longer matches.
 */
export const patchIdOf = (text: string): string => {
  let hash = 7;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + (text.codePointAt(index) ?? 0)) % 4_294_967_291;
  }

  return hash.toString(16).padStart(8, "0");
};

const waives = DecisionSubject.isAnyOf(["Waiver"]);

/**
 * The answer's diff a `Waiver` decision carries, when it carries one under
 * the same `patch` label a finish uses: the page draws the marker's file
 * from it, with the marker at its line.
 */
export const waiverPatchOf = (decision: Decision): Option.Option<string> =>
  waives(decision.subject)
    ? Option.map(
        Arr.findFirst(decision.evidence, ({ label }) => label === PATCH_LABEL),
        ({ value }) => value
      ).pipe(Option.filter((patch) => patch.trim().length > 0))
    : Option.none();
