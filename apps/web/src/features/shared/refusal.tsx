/**
 * A refusal, as `git push` printed it. The words are `@repo/protocol/render`'s
 * (`headline` and `explain`, the one renderer for git, the CLI, MCP and the
 * web, AGENTS.md principle 3); this view only sets them: each refusal's lines
 * verbatim, its tag in the rubric colour, then its `next` command to copy.
 * Whether retrying can help picks the mark, never the words.
 */
import type { Refusal } from "@repo/protocol/refusal";
import { explain, headline } from "@repo/protocol/render";
import type { Array } from "effect";
import { OctagonX, RotateCcw } from "lucide-react";

import { CommandLine } from "./command.tsx";

/** One refusal's lines, with its tag set apart on the first. */
const Lines = ({ refusal }: { readonly refusal: Refusal }) => {
  const prefix = `${refusal._tag}:`;

  return (
    <samp className="block max-w-[96ch] font-mono text-[0.8125rem] leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
      {explain([refusal]).map((line) => (
        <span className="block" key={line}>
          {line.startsWith(prefix) ? (
            <>
              <b className="text-refused font-semibold">{prefix}</b>
              {line.slice(prefix.length)}
            </>
          ) : (
            line
          )}
        </span>
      ))}
    </samp>
  );
};

export const RefusalView = ({
  refusals,
}: {
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
}) => (
  <section
    aria-label={`Refused: ${headline(refusals)}`}
    className="border-t-refused border-b-rule border-t-2 border-b"
  >
    <h2 className="text-refused flex items-center gap-2 py-2 font-mono text-sm font-semibold">
      <OctagonX aria-hidden="true" className="size-4 shrink-0" />
      {headline(refusals)}
    </h2>
    <ol className="flex flex-col">
      {refusals.map((refusal) => {
        const Mark = refusal.retryable ? RotateCcw : OctagonX;

        return (
          <li
            className="border-rule flex flex-col gap-2 border-t py-3"
            data-refusal={refusal._tag}
            data-retryable={refusal.retryable}
            key={explain([refusal]).join("\n")}
          >
            <div className="flex items-start gap-2">
              <Mark
                aria-hidden="true"
                className={`mt-1 size-3.5 shrink-0 ${refusal.retryable ? "text-waiting" : "text-refused"}`}
              />
              <Lines refusal={refusal} />
            </div>
            <CommandLine command={refusal.next} />
          </li>
        );
      })}
    </ol>
  </section>
);
