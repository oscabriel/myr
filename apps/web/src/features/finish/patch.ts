import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { Array as Arr, Option } from "effect";

export const PATCH_LABEL = "patch";

export const FORK_LABEL = "fork";

export type FinishDecision = Decision & {
  readonly subject: Extract<DecisionSubject, { readonly _tag: "Finish" }>;
};

const finishes = DecisionSubject.isAnyOf(["Finish"]);

export const isFinishDecision = (
  decision: Decision
): decision is FinishDecision => finishes(decision.subject);

export const patchOf = (decision: Decision): Option.Option<string> =>
  isFinishDecision(decision)
    ? Option.map(
        Arr.findFirst(decision.evidence, ({ label }) => label === PATCH_LABEL),
        ({ value }) => value
      ).pipe(Option.filter((patch) => patch.trim().length > 0))
    : Option.none();

// git ends a `---`/`+++` line with a tab when its path holds a space, and `diff
// -u` puts its timestamp after one: the path stops at the tab.
const NEW_FILE = /^\+\+\+ (?:b\/)?(?<path>[^\t]+)(?:\t.*)?$/u;

const OLD_FILE = /^--- (?:a\/)?(?<path>[^\t]+)(?:\t.*)?$/u;

const RENAMED = /^rename to (?<path>.+)$/u;

const HEADER = /^diff --git a\/.+ b\/(?<path>.+)$/u;

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

export const changedFiles = (patch: string): readonly string[] => [
  ...fileBlocks(patch).keys(),
];

/**
 * A new head that changes the file changes its id, so a mark kept against the
 * old one no longer matches.
 */
export const patchIdOf = (text: string): string => {
  let hash = 7;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + (text.codePointAt(index) ?? 0)) % 4_294_967_291;
  }

  return hash.toString(16).padStart(8, "0");
};

const waives = DecisionSubject.isAnyOf(["Waiver"]);

export const waiverPatchOf = (decision: Decision): Option.Option<string> =>
  waives(decision.subject)
    ? Option.map(
        Arr.findFirst(decision.evidence, ({ label }) => label === PATCH_LABEL),
        ({ value }) => value
      ).pipe(Option.filter((patch) => patch.trim().length > 0))
    : Option.none();
