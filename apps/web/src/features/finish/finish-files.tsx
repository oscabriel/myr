/**
 * A finish's changed files as a list the rail (or, below the shell's
 * width, a sheet) holds: the ask's territory first, then tests, then the
 * rest, each a row with its change as a letter (A, M or D, in the diff's
 * tints), its path, its `+n −m`, whether this reader marked it read (a
 * muted check, the word for a screen reader) and whether a refusal pointed
 * into it (the refused cross). Choosing one scrolls the diff to it.
 */
import { Check, OctagonX } from "lucide-react";

import { diffAnchor } from "../code/paths.ts";
import { ChangeCounts } from "../code/plain-diff.tsx";
import { AppLink } from "../shared/link.tsx";
import type { Part, PatchFile } from "./files.ts";

const LETTERS = {
  added: { letter: "A", tone: "text-diff-add-sign", word: "added" },
  deleted: { letter: "D", tone: "text-diff-del-sign", word: "deleted" },
  modified: { letter: "M", tone: "text-muted-foreground", word: "modified" },
} as const;

const PART_NAMES = {
  other: "Everything else",
  territory: "In the territory",
  tests: "Tests",
} as const satisfies Record<Part, string>;

/** A path as two parts: its name first, then its folder, muted, which gives way first. */
const PathWords = ({ path }: { readonly path: string }) => {
  const slash = path.lastIndexOf("/");

  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={path}>
      <span className="shrink-0">{path.slice(slash + 1)}</span>
      {slash === -1 ? null : (
        <span className="text-label text-muted-foreground min-w-0 truncate font-normal">
          {path.slice(0, slash)}
        </span>
      )}
    </span>
  );
};

export const FinishFileList = ({
  current,
  files,
  href,
  read,
  refused,
}: {
  readonly files: readonly PatchFile[];
  /** The page's own address, which each row adds its file's anchor to. */
  readonly href: string;
  readonly read: ReadonlySet<string>;
  readonly refused: ReadonlySet<string>;
  /** The file the diff stands at. */
  readonly current?: string | undefined;
}) => (
  <nav
    aria-label="Changed files"
    className="flex min-h-0 flex-col overflow-y-auto py-2"
  >
    {(["territory", "tests", "other"] as const).map((part) => {
      const mine = files.filter((file) => file.part === part);

      return mine.length === 0 ? null : (
        <section
          aria-label={PART_NAMES[part]}
          className="flex flex-col"
          key={part}
        >
          <h3 className="text-label text-muted-foreground px-3 pt-2 pb-1">
            {PART_NAMES[part]}
          </h3>
          <ul className="flex flex-col">
            {mine.map((file) => {
              const { letter, tone, word } = LETTERS[file.file.status];
              const isRead = read.has(file.file.path);
              const isRefused = refused.has(file.file.path);

              return (
                <li
                  data-file={file.file.path}
                  data-read={isRead}
                  key={file.file.path}
                >
                  <AppLink
                    aria-current={
                      current === file.file.path ? "true" : undefined
                    }
                    className="text-ui hover:bg-surface aria-[current=true]:bg-surface flex h-8 items-center gap-2 px-3 no-underline transition-colors duration-[120ms]"
                    hash={diffAnchor(file.file.path)}
                    replace
                    resetScroll={false}
                    to={href}
                  >
                    <span
                      aria-hidden="true"
                      className={`text-mono w-3 shrink-0 font-mono font-semibold ${tone}`}
                    >
                      {letter}
                    </span>
                    <span className="sr-only">{word}:</span>
                    <PathWords path={file.file.path} />
                    {isRefused ? (
                      <span className="text-refused flex shrink-0 items-center">
                        <OctagonX
                          aria-hidden="true"
                          className="size-3.5"
                          strokeWidth={1.75}
                        />
                        <span className="sr-only">, refused here</span>
                      </span>
                    ) : null}
                    {isRead ? (
                      <span className="text-muted-foreground flex shrink-0 items-center">
                        <Check
                          aria-hidden="true"
                          className="size-3.5"
                          strokeWidth={1.75}
                        />
                        <span className="sr-only">, read</span>
                      </span>
                    ) : null}
                    <ChangeCounts {...file.counts} header />
                  </AppLink>
                </li>
              );
            })}
          </ul>
        </section>
      );
    })}
  </nav>
);
