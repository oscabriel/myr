/**
 * The verdict on an answer, as a report sheet: the fields that name what
 * was judged (head, base, merged tree, patch id, check version, when), the
 * gate's stages in a strip with the outcome under it (a refusal reads as
 * `git push` printed it), each lane's result and time, the held-back checks
 * as one line per area, and, once it landed, the landing's credit trailers
 * and its commit.
 *
 * Held-back checks show only what `HeldBackResult` carries: an area, how
 * many passed of how many, and the suite's root. A lane's log is
 * never shown here; a refusal that needs it names it, with the command
 * that reads it.
 */
import type {
  HeldBackResult,
  LaneOutcome,
  LaneResult,
  Verdict,
} from "@repo/protocol/domain/answer";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { DateTime } from "effect";
import {
  Ban,
  Check,
  LockKeyhole,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.tsx";
import { askPath } from "../ask/ask-page.tsx";
import { CODE, Field, Fields, LINK, Region } from "../ask/fields.tsx";
import { CommandLine } from "../shared/command.tsx";
import { CreditTrailers } from "../shared/credits.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { OutcomeView, StageStrip } from "../shared/outcome.tsx";
import { When } from "../shared/time.tsx";

/** How long a lane ran: "640 ms", "8.3 s", "2 min 5 s". */
export const durationText = (millis: number) => {
  if (millis < 1000) {
    return `${millis} ms`;
  }

  if (millis < 60_000) {
    return `${(millis / 1000).toFixed(1)} s`;
  }

  const seconds = Math.round(millis / 1000);

  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

/** Each lane result as a mark, a word and its role colour (DESIGN.md: the word first). */
const results = {
  blocked: { icon: Ban, tone: "text-waiting", word: "blocked" },
  failed: { icon: X, tone: "text-refused", word: "failed" },
  flaked: { icon: RotateCcw, tone: "text-waiting", word: "flaked" },
  loadError: { icon: TriangleAlert, tone: "text-refused", word: "load error" },
  passed: { icon: Check, tone: "text-landed", word: "passed" },
} as const satisfies Record<
  LaneOutcome,
  { readonly icon: LucideIcon; readonly tone: string; readonly word: string }
>;

const HEAD = "text-muted-foreground h-8 px-0 text-xs font-medium";

/** The lanes the platform ran on the merged tree: each one's command, result and time. */
export const LaneTable = ({
  lanes,
}: {
  readonly lanes: readonly LaneResult[];
}) => {
  if (lanes.length === 0) {
    return <EmptyState title="No lane ran on this answer." />;
  }

  return (
    <Table className="border-rule border-t text-sm">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Lane and command</TableHead>
          <TableHead className={`${HEAD} pl-4`}>Result</TableHead>
          <TableHead className={`${HEAD} pl-4 text-right`}>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lanes.map(({ command, durationMs, lane, result }) => {
          const { icon: Icon, tone, word } = results[result];

          return (
            <TableRow
              className="border-rule hover:bg-transparent"
              data-lane={lane}
              data-result={result}
              key={lane}
            >
              <TableCell className="px-0 py-2 align-top whitespace-normal">
                <span className="flex min-w-0 flex-col">
                  <span className={`${CODE} font-medium`}>{lane}</span>
                  <code className={`${CODE} text-muted-foreground`}>
                    {command}
                  </code>
                </span>
              </TableCell>
              <TableCell className={`py-2 pl-4 align-top ${tone}`}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="font-medium">{word}</span>
                </span>
              </TableCell>
              <TableCell className="py-2 pr-0 pl-4 text-right align-top">
                {durationText(durationMs)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

/** Held-back checks: one line per area, as the landing's trailer spells it, and nothing else. */
export const HeldBackBits = ({
  results: areas,
}: {
  readonly results: readonly HeldBackResult[];
}) => (
  <ul
    aria-label="Held-back checks by area"
    className="text-sealed flex flex-col gap-1 font-mono text-[0.8125rem] leading-6"
  >
    {areas.map(({ area, passed, suite, total }) => (
      <li
        className="flex items-start gap-2 [overflow-wrap:anywhere]"
        data-area={area}
        key={area}
      >
        <LockKeyhole aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
        <span className="min-w-0">
          {area} {passed}/{total} @ {suite}
        </span>
      </li>
    ))}
  </ul>
);

const short = (sha: string) => sha.slice(0, 7);

/** A git id, short as git prints it, whole on hover. */
const Sha = ({ sha }: { readonly sha: string }) => (
  <code className={CODE} title={sha}>
    {short(sha)}
  </code>
);

export const AnswerView = ({
  landing,
  now,
  verdict,
}: {
  readonly landing?: LandingView;
  readonly now: DateTime.Utc;
  readonly verdict: Verdict | undefined;
}) => {
  if (verdict === undefined) {
    return <EmptyState title="No answer to this ask has been checked yet." />;
  }

  return (
    <>
      <Fields label="What was judged">
        <Field label="Ask">
          <a
            className={`${LINK} ${CODE}`}
            href={askPath(verdict.project, verdict.ask)}
          >
            {verdict.ask}
          </a>
        </Field>
        <Field label="Judged">
          <When at={verdict.at} now={now} />{" "}
          <span className="text-muted-foreground">
            by the {verdict.verifier}
          </span>
        </Field>
        <Field label="Head">
          <Sha sha={verdict.head} />
        </Field>
        <Field label="Base">
          <Sha sha={verdict.base} />
        </Field>
        <Field label="Merged tree">
          <Sha sha={verdict.tree} />
        </Field>
        <Field label="Patch id">
          <Sha sha={verdict.patchId} />
        </Field>
        <Field label="Check version">
          <code className={CODE}>{verdict.checkVersion}</code>
        </Field>
      </Fields>

      <Region id="answer-gate" title="Gate">
        <StageStrip outcome={verdict.outcome} stage={verdict.stage} />
        <OutcomeView outcome={verdict.outcome} />
      </Region>

      <Region id="answer-lanes" title="Lanes">
        <LaneTable lanes={verdict.lanes} />
      </Region>

      {verdict.heldBack.length === 0 ? null : (
        <Region id="answer-held-back" title="Held-back checks">
          <p className="text-muted-foreground max-w-[70ch] text-sm">
            Checks the answer could not see. Each area shows how many passed,
            and the root of the suite the project committed to before the claim.
          </p>
          <HeldBackBits results={verdict.heldBack} />
        </Region>
      )}

      {landing === undefined ? null : (
        <Region id="answer-landing" title="Landing">
          <CreditTrailers
            assisted={landing.assisted}
            credits={landing.credits}
            {...(landing.heldBackTrailer === undefined
              ? {}
              : { heldBack: landing.heldBackTrailer })}
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              The landing commit, in a clone of {landing.project}
            </span>
            <CommandLine command={`git show ${landing.sha}`} />
          </div>
        </Region>
      )}
    </>
  );
};
