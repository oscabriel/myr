/**
 * The hero's two panels: the usual flow by its mechanism under an X, and an
 * ask landing through the gate under a check. Each flow is drawn as inline
 * SVG at its own size, never scaled, so its text keeps the type floor: on a
 * phone too narrow for it the drawing scrolls inside its panel. Each is named
 * in full for a screen reader. No product is named.
 */
import { Check, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

interface Step {
  readonly name: string;
  readonly says: string;
  /** Drawn in the landed colour: the step that puts the change on main. */
  readonly onMain?: boolean;
}

interface Flow {
  readonly id: "usual" | "gate";
  readonly title: string;
  readonly says: string;
  readonly mark: LucideIcon;
  readonly steps: readonly Step[];
  /** The step a loop goes back to, from the step after it. */
  readonly loop: { readonly from: number; readonly to: number };
}

const FLOWS: readonly Flow[] = [
  {
    id: "usual",
    loop: { from: 3, to: 2 },
    mark: X,
    says: "A person reads each change and approves it, as many rounds as it takes.",
    steps: [
      { name: "issue", says: "a change described in prose" },
      { name: "branch", says: "a contributor's copy to work on" },
      { name: "pull request", says: "the diff waits for a reader" },
      { name: "review comments", says: "rounds until a reader approves" },
      { name: "merge button", says: "whoever has the right presses it" },
      { name: "main", says: "what a reader approved" },
    ],
    title: "The usual flow",
  },
  {
    id: "gate",
    loop: { from: 3, to: 2 },
    mark: Check,
    says: "The project states the change as a check, and the gate runs it on the exact tree that would land.",
    steps: [
      { name: "ask", says: "a check that fails on main today" },
      { name: "claim", says: "one claimant, a fork of their own" },
      { name: "answer", says: "a commit, pushed with plain git" },
      { name: "gate", says: "seven stages; a refusal goes back" },
      {
        name: "main",
        onMain: true,
        says: "lands as a commit, with credit",
      },
    ],
    title: "Through the gate",
  },
];

const WIDTH = 288;

const STEP = 52;

const TOP = 14;

const LINE_X = 28;

const at = (index: number) => TOP + index * STEP;

/** Each step settles in turn, once, where motion is welcome. */
const settling = (index: number): CSSProperties => ({
  animationDelay: `${index * 140}ms`,
});

const Loop = ({ flow }: { readonly flow: Flow }) => {
  const from = at(flow.loop.from);
  const to = at(flow.loop.to);

  return (
    <g
      className={flow.id === "gate" ? "stroke-refused" : "stroke-foreground"}
      fill="none"
      strokeDasharray={flow.id === "gate" ? "4 3" : undefined}
      strokeWidth={1.5}
    >
      <path
        d={`M${LINE_X - 6} ${from} C4 ${from} 4 ${to} ${LINE_X - 7} ${to}`}
      />
      <path
        d={`M${LINE_X - 12} ${to - 4} L${LINE_X - 7} ${to} L${LINE_X - 12} ${to + 4}`}
        strokeDasharray="none"
      />
    </g>
  );
};

const FlowDrawing = ({ flow }: { readonly flow: Flow }) => {
  const height = at(flow.steps.length - 1) + 30;

  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height={height}
      viewBox={`0 0 ${WIDTH} ${height}`}
      width={WIDTH}
    >
      <line
        className="stroke-rule"
        strokeWidth={2}
        x1={LINE_X}
        x2={LINE_X}
        y1={at(0)}
        y2={at(flow.steps.length - 1)}
      />
      <Loop flow={flow} />
      {flow.steps.map((step, index) => (
        <g data-step={step.name} key={step.name}>
          <circle
            className={`${
              step.onMain === true
                ? "fill-landed stroke-landed"
                : "fill-card stroke-foreground"
            } origin-center [transform-box:fill-box] ${
              flow.id === "gate" ? "motion-safe:animate-stamp" : ""
            }`}
            cx={LINE_X}
            cy={at(index)}
            r={6}
            strokeWidth={1.75}
            style={flow.id === "gate" ? settling(index) : undefined}
          />
          <text
            className="fill-foreground text-ui font-medium"
            x={LINE_X + 18}
            y={at(index) + 5}
          >
            {step.name}
          </text>
          <text
            className="fill-muted-foreground text-label font-normal"
            x={LINE_X + 18}
            y={at(index) + 24}
          >
            {step.says}
          </text>
        </g>
      ))}
    </svg>
  );
};

const Panel = ({ flow }: { readonly flow: Flow }) => {
  const Mark = flow.mark;

  return (
    <section
      aria-labelledby={`flow-${flow.id}`}
      className="bg-card border-rule flex min-w-0 flex-col gap-4 rounded-md border p-4"
      data-flow={flow.id}
    >
      <div className="flex items-center gap-2.5">
        <Mark
          aria-hidden="true"
          className="text-foreground motion-safe:animate-stamp size-6 shrink-0"
          strokeWidth={2}
        />
        <h2 className="text-title" id={`flow-${flow.id}`}>
          {flow.title}
        </h2>
      </div>
      <p className="text-ui text-muted-foreground max-w-(--measure)">
        {flow.says}
      </p>
      <div className="overflow-x-auto">
        <FlowDrawing flow={flow} />
      </div>
      <ol className="sr-only">
        {flow.steps.map((step) => (
          <li key={step.name}>
            {step.name}: {step.says}
          </li>
        ))}
      </ol>
    </section>
  );
};

/**
 * Side by side once two drawings fit at their own size (288 px each, inside
 * a card's padding, beside the gap and the gutters: about 704 px), so only a
 * phone, or a width just past one, stacks them. `tablet` (640 px) would be
 * too soon: each drawing would scroll inside its panel.
 */
export const Comparison = () => (
  <div className="diffsplit:grid-cols-2 grid gap-5">
    {FLOWS.map((flow) => (
      <Panel flow={flow} key={flow.id} />
    ))}
  </div>
);
