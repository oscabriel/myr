/**
 * The gate in words and in git's own output: the seven stages in order, one
 * column each, the bridges of the music box above, then a refused push and a
 * landed one as a terminal prints them.
 */
import { StageName } from "@repo/protocol/domain/outcome";
import type { ReactNode } from "react";

import { stageNames, stageRuns } from "../shared/status-line.tsx";
import { landedPush, refusedPush } from "./transcript.ts";
import type { Transcript as Printed } from "./transcript.ts";

/**
 * Stacked below `tablet`, each stage's caption sits under its name; in seven
 * columns the caption fits only from `columns`, so between the two it is
 * left out.
 */
const Stages = () => (
  <ol className="tablet:grid-cols-7 grid grid-cols-1 gap-x-3 gap-y-3">
    {StageName.literals.map((stage, index) => (
      <li
        className="tablet:flex-col tablet:items-center tablet:text-center flex flex-col gap-x-3 gap-y-1"
        data-stage={stage}
        key={stage}
      >
        <span className="text-ui font-medium">
          <span className="text-muted-foreground tablet:sr-only tabular-nums">
            {index + 1}.{" "}
          </span>
          {stageNames(stage).label}
        </span>
        <span
          className="text-label text-muted-foreground tablet:hidden columns:block block font-normal"
          data-caption={stage}
        >
          {stageRuns(stage)}
        </span>
      </li>
    ))}
  </ol>
);

const Line = ({
  line,
  tag,
}: {
  readonly line: Printed["lines"][number];
  readonly tag: string | undefined;
}) => {
  const parts = tag === undefined ? [line.text] : line.text.split(tag);

  const text: ReactNode = parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          // A tag's place on its line never moves: its index is its key.
          <span className="text-refused font-semibold" key={index}>
            {tag}
          </span>,
          part,
        ]
  );

  return (
    <span>
      {line.kind === "command" ? (
        <span className="text-muted-foreground select-none">$ </span>
      ) : null}
      {line.kind === "remote" ? (
        <span className="text-muted-foreground">remote: </span>
      ) : null}
      {text}
      {"\n"}
    </span>
  );
};

const Output = ({
  caption,
  outcome,
  transcript,
}: {
  readonly caption: string;
  readonly outcome: "landed" | "refused";
  readonly transcript: Printed;
}) => (
  <figure className="flex min-w-0 flex-col gap-2" data-output={outcome}>
    <pre
      className="border-rule bg-surface text-mono leading-terminal border px-4 py-3 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap"
      data-refusal={transcript.tag}
    >
      {transcript.lines.map((line, index) => (
        // A printed line never moves: its place on the screen is its key.
        <Line key={index} line={line} tag={transcript.tag} />
      ))}
    </pre>
    <figcaption className="text-ui text-muted-foreground">{caption}</figcaption>
  </figure>
);

export const GateDrawing = ({
  platformUrl,
}: {
  readonly platformUrl: string;
}) => (
  <div className="flex flex-col gap-8">
    <figure className="flex flex-col gap-4">
      <Stages />
      <figcaption className="text-ui text-muted-foreground max-w-(--measure)">
        The seven bridges of Fig 1, in order, cheapest first. The first stage
        that fails refuses the answer, with every reason that stage found; an
        answer that passes them all lands on main.
      </figcaption>
    </figure>
    <div className="columns:grid-cols-2 grid gap-5">
      <Output
        caption="Refused, in git's own output, with the command to run next."
        outcome="refused"
        transcript={refusedPush(platformUrl)}
      />
      <Output
        caption="Taken at the push; once the later stages pass, it lands as a commit crediting every person."
        outcome="landed"
        transcript={landedPush()}
      />
    </div>
  </div>
);
