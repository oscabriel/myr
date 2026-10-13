/**
 * The gate as arcs over a track: an answer enters on the left, meets the
 * seven stages in order, and either leaves the track at the first that
 * refuses it or reaches main. Inline SVG with no text in it; the stages'
 * names sit in the page beneath their ticks, one column each.
 */
import { StageName } from "@repo/protocol/domain/outcome";
import type { CSSProperties, ReactNode } from "react";

import { stageNames, stageRuns } from "../shared/status-line.tsx";
import { landedPush, refusedPush } from "./transcript.ts";
import type { Transcript as Printed } from "./transcript.ts";

const COLUMN = 100;

const WIDTH = COLUMN * StageName.literals.length;

const TRACK = 92;

const HEIGHT = 124;

/** The stage that refuses the drawn answer: an `OutOfScope`, the shape stage's. */
const REFUSED_AT = StageName.literals.indexOf("shape");

const tickX = (index: number) => COLUMN / 2 + index * COLUMN;

/** Each stage settles in turn, once, where motion is welcome. */
const settling = (index: number): CSSProperties => ({
  animationDelay: `${index * 120}ms`,
});

const arch = (inset: number, top: number) =>
  `M${inset} ${TRACK} V${top + 36} C${inset} ${top + 8} ${inset + 90} ${top} ${WIDTH / 2} ${top} C${WIDTH - inset - 90} ${top} ${WIDTH - inset} ${top + 8} ${WIDTH - inset} ${top + 36} V${TRACK}`;

const Drawing = () => {
  const refusedX = tickX(REFUSED_AT);

  return (
    <svg
      aria-hidden="true"
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <g className="stroke-rule" fill="none" strokeWidth={2}>
        <path d={arch(14, 8)} />
        <path d={arch(30, 20)} />
      </g>
      <path
        className="stroke-muted-foreground"
        d={arch(46, 32)}
        fill="none"
        strokeWidth={2}
      />
      <line
        className="stroke-foreground"
        strokeWidth={2}
        x1={0}
        x2={WIDTH - 14}
        y1={TRACK}
        y2={TRACK}
      />
      <path
        className="stroke-landed"
        d={`M${WIDTH - 22} ${TRACK - 7} L${WIDTH - 12} ${TRACK} L${WIDTH - 22} ${TRACK + 7}`}
        fill="none"
        strokeWidth={2}
      />
      <path
        className="stroke-refused"
        d={`M${refusedX} ${TRACK} C${refusedX + 24} ${TRACK} ${refusedX + 30} ${HEIGHT - 6} ${refusedX + 64} ${HEIGHT - 6} H${refusedX + 110}`}
        fill="none"
        strokeDasharray="5 4"
        strokeWidth={2}
      />
      {StageName.literals.map((stage, index) => (
        <circle
          className="fill-card stroke-foreground motion-safe:animate-stamp origin-center [transform-box:fill-box]"
          cx={tickX(index)}
          cy={TRACK}
          key={stage}
          r={7}
          strokeWidth={2}
          style={settling(index)}
        />
      ))}
    </svg>
  );
};

const Stages = () => (
  <ol className="tablet:grid-cols-7 grid grid-cols-1 gap-x-3 gap-y-3">
    {StageName.literals.map((stage, index) => (
      <li
        className="tablet:flex-col tablet:items-center tablet:text-center flex items-baseline gap-x-3 gap-y-1"
        data-stage={stage}
        key={stage}
      >
        <span className="text-ui font-medium">
          <span className="text-muted-foreground tablet:sr-only tabular-nums">
            {index + 1}.{" "}
          </span>
          {stageNames(stage).label}
        </span>
        <span className="text-label text-muted-foreground columns:block hidden font-normal">
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
      <Drawing />
      <Stages />
      <figcaption className="text-ui text-muted-foreground max-w-(--measure)">
        An answer meets the stages in order, cheapest first. The first stage
        that fails refuses it, with every reason that stage found; an answer
        that passes them all lands on main.
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
