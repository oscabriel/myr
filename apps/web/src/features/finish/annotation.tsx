import type { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Hourglass, OctagonX, RotateCcw } from "lucide-react";

export interface PlacedRefusal {
  readonly refusal: Refusal;
  readonly path: string;
  readonly line: number;
  readonly round: number;
}

export const RefusalNote = ({ placed }: { readonly placed: PlacedRefusal }) => {
  const [first = "", ...rest] = explain([placed.refusal]).filter(
    (line) => !line.startsWith("  at: ")
  );

  const prefix = `${placed.refusal._tag}:`;
  const Mark = placed.refusal.retryable ? RotateCcw : OctagonX;

  return (
    <div
      className="border-y-refused/40 bg-background flex items-start gap-2 border-y px-4 py-2 font-sans"
      data-refusal={placed.refusal._tag}
      data-retryable={placed.refusal.retryable}
    >
      <Mark
        aria-hidden="true"
        className={`mt-0.5 size-3.5 shrink-0 ${placed.refusal.retryable ? "text-waiting" : "text-refused"}`}
        strokeWidth={1.75}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-label text-muted-foreground font-normal">
          Refused here in round {placed.round}
        </p>
        <samp className="text-mono leading-terminal block font-mono [overflow-wrap:anywhere] whitespace-pre-wrap">
          <span className="block">
            <b className="text-refused font-semibold">{prefix}</b>
            {first.slice(prefix.length)}
          </span>
          {rest.map((line) => (
            <span className="text-muted-foreground block" key={line}>
              {line}
            </span>
          ))}
        </samp>
      </div>
    </div>
  );
};

export const MarkerNote = ({
  marker,
  reason,
}: {
  readonly marker: string;
  readonly reason: string;
}) => (
  <div
    className="border-y-waiting/40 bg-background flex items-start gap-2 border-y px-4 py-2 font-sans"
    data-marker={marker}
  >
    <Hourglass
      aria-hidden="true"
      className="text-waiting mt-0.5 size-3.5 shrink-0"
      strokeWidth={1.75}
    />
    <p className="text-ui min-w-0">
      <span className="text-waiting font-medium">Waits on this decision:</span>{" "}
      <code className="text-mono font-mono">{marker}</code>, {reason}
    </p>
  </div>
);
