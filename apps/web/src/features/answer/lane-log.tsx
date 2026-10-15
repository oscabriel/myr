/**
 * A failed lane's log, read when its reader asks. The contract lets in the
 * answer's own claimant and the project's maintainers; anyone else hears the
 * refusal. The text is the check's own output, so it is shown as text only.
 */
import { useAtom, useAtomValue } from "@effect/atom-react";
import type { ProjectName } from "@repo/protocol/ids";
import { useLocation } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { evidenceAtom } from "../../client/evidence.ts";
import type { Evidence } from "../../client/evidence.ts";
import { Button } from "../../components/ui/button.tsx";
import { hereOf, signInHref } from "../auth/session-slot.tsx";
import { whoAtom } from "../auth/who.ts";
import { CallFailure } from "../shared/call-failure.tsx";

const LINK = "decoration-rule font-medium underline hover:decoration-current";

export interface LogReaderProps {
  readonly lane: string;
  readonly logRef: string;
  readonly project: ProjectName;
}

const Log = ({ evidence }: { readonly evidence: Evidence }) => (
  <figure className="flex min-w-0 flex-col gap-1.5" data-log={evidence.lane}>
    <figcaption className="text-label text-muted-foreground">
      The log of {evidence.lane}
      {evidence.truncated ? ". Truncated: the last 256 KiB." : ""}
    </figcaption>
    <pre className="border-rule bg-surface text-mono leading-terminal max-h-[32rem] overflow-auto border p-3 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap">
      {evidence.text}
    </pre>
  </figure>
);

export const LaneLogView = ({
  here,
  onShow,
  result,
  signedOut,
}: {
  readonly here: string;
  readonly onShow: () => void;
  readonly result: AsyncResult.AsyncResult<Evidence, unknown>;
  readonly signedOut: boolean;
}) => {
  if (AsyncResult.isSuccess(result)) {
    return <Log evidence={result.value} />;
  }

  if (signedOut) {
    return (
      <p className="text-ui">
        <a className={LINK} href={signInHref(here)}>
          Sign in to read the log
        </a>
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button
        disabled={result.waiting}
        onClick={onShow}
        size="sm"
        type="button"
        variant="outline"
      >
        {result.waiting ? "Reading the log…" : "Show the log"}
      </Button>
      {AsyncResult.isFailure(result) ? (
        <div aria-live="polite" className="w-full">
          <CallFailure cause={result.cause} doing="read the log" here={here} />
        </div>
      ) : null}
    </div>
  );
};

/** The answer's route draws this one; the page's own tests draw none. */
export const EvidenceLog = ({ logRef, project }: LogReaderProps) => {
  const [result, show] = useAtom(evidenceAtom(logRef));
  const who = useAtomValue(whoAtom);
  const here = useLocation({ select: hereOf });

  return (
    <LaneLogView
      here={here}
      onShow={() => {
        show({ project, ref: logRef });
      }}
      result={result}
      signedOut={AsyncResult.isSuccess(who) && Option.isNone(who.value)}
    />
  );
};
