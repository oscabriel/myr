/**
 * A `Finish` decision's page: the answer's diff beside the ask's want and the
 * verdict, and the git lines a decider runs to finish it from their own
 * clone. The web shows the diff and the commands; it never calls `finish`
 * (that contract's surfaces are RPC, MCP and the CLI; spec §3.2).
 *
 * What the page reads from the decision's evidence (ASSUMPTION: the
 * platform's `Finish` decisions carry these; issue 504's Comments ask for
 * them): `patch`, the answer's unified diff, and `fork`, the name of the
 * answer's fork (spec §4.5: `<project>--<ask>--<handle>`), where a finish
 * fetches the head and pushes its commits. Without a patch the page shows
 * the lines and no diff; without a fork it names the fork by the spec's
 * pattern and leaves the answerer's handle for the decider to fill in.
 */
import { Brand } from "@repo/brand";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import type { Decision, DecisionSubject } from "@repo/protocol/domain/decision";
import { Array as Arr, Option } from "effect";
import { FileDiff } from "lucide-react";
import type { ReactNode } from "react";

import { CommandLine } from "../shared/command.tsx";
import { OutcomeView, StageStrip } from "../shared/outcome.tsx";
import { ClientPatchDiffs } from "./client-diff.tsx";
import { changedFiles, FORK_LABEL, patchOf } from "./patch.ts";

export { patchOf } from "./patch.ts";

/** A decision whose subject is a finish. */
export type FinishDecision = Decision & {
  readonly subject: Extract<DecisionSubject, { readonly _tag: "Finish" }>;
};

/** Where the answer's head lives: its fork's git URL on the platform. */
const remoteOf = (decision: FinishDecision, platformUrl: string) =>
  Arr.findFirst(decision.evidence, ({ label }) => label === FORK_LABEL).pipe(
    Option.map(
      ({ href, value }) => href ?? `${platformUrl}/${value.trim()}.git`
    ),
    Option.getOrElse(
      () =>
        `${platformUrl}/${decision.project}--${decision.subject.ask}--<answerer>.git`
    )
  );

/** The lines that take the answer's head into a clone, put the decider's commits on it, and finish it. */
const finishLines = (
  decision: FinishDecision,
  platformUrl: string,
  verdict: Verdict | undefined
) => {
  const remote = remoteOf(decision, platformUrl);
  const { ask, head } = decision.subject;
  const base = verdict?.base ?? "<base>";

  return {
    fetch: [`git fetch ${remote} ${head}`, "git switch --detach FETCH_HEAD"],
    finish: `${Brand.cli} finish --project ${decision.project} --ask ${ask} --base ${base} --head $(git rev-parse HEAD) --requestId finish-$(git rev-parse HEAD) --yes`,
    push: `git push ${remote} HEAD:main`,
  };
};

const SECTION = "flex flex-col gap-3";

const TITLE = "text-base font-semibold";

const LABEL = "text-muted-foreground text-xs font-medium";

/** How the diff is drawn by default: in the browser, after the page loads. */
const inBrowser = (patch: string) => (
  <ClientPatchDiffs
    fallback={
      <output className="text-muted-foreground block text-sm">
        The diff is drawn in your browser.
      </output>
    }
    patch={patch}
  />
);

const Want = ({ ask }: { readonly ask: Ask }) => (
  <section aria-labelledby="finish-want" className={SECTION}>
    <h3 className={TITLE} id="finish-want">
      What the ask wants
    </h3>
    <p className="max-w-[70ch] text-base">{ask.brief.want}</p>
    <p className="text-sm">
      <a
        className="decoration-rule underline hover:decoration-current"
        href={`/${ask.project}/asks/${ask.id}`}
      >
        The ask <span className="font-mono text-[0.8125rem]">{ask.id}</span> in
        full
      </a>
    </p>
  </section>
);

const VerdictPart = ({ verdict }: { readonly verdict: Verdict }) => (
  <section aria-labelledby="finish-verdict" className={SECTION}>
    <h3 className={TITLE} id="finish-verdict">
      Verdict at{" "}
      <code className="font-mono text-base">{verdict.head.slice(0, 7)}</code>
    </h3>
    <OutcomeView outcome={verdict.outcome} />
    <StageStrip outcome={verdict.outcome} stage={verdict.stage} />
  </section>
);

const Diff = ({
  diff,
  patch,
}: {
  readonly diff: (patch: string) => ReactNode;
  readonly patch: string;
}) => {
  const files = changedFiles(patch);

  return (
    <section aria-labelledby="finish-diff" className={SECTION}>
      <h3 className={TITLE} id="finish-diff">
        The answer&apos;s diff
      </h3>
      <div className="flex flex-col gap-1.5">
        <h4 className={LABEL}>
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </h4>
        <ul
          className="flex flex-col gap-0.5 font-mono text-[0.8125rem] leading-6"
          data-diff="files"
        >
          {files.map((file) => (
            <li
              className="flex items-start gap-2 [overflow-wrap:anywhere]"
              key={file}
            >
              <FileDiff
                aria-hidden="true"
                className="text-muted-foreground mt-1 size-3.5 shrink-0"
              />
              {file}
            </li>
          ))}
        </ul>
      </div>
      {diff(patch)}
    </section>
  );
};

const Lines = ({
  decision,
  platformUrl,
  verdict,
}: {
  readonly decision: FinishDecision;
  readonly platformUrl: string;
  readonly verdict: Verdict | undefined;
}) => {
  const lines = finishLines(decision, platformUrl, verdict);

  return (
    <section aria-labelledby="finish-lines" className={SECTION}>
      <h3 className={TITLE} id="finish-lines">
        Finish it from your clone
      </h3>
      <ol className="flex flex-col gap-4 text-sm">
        <li className="flex flex-col gap-2">
          <p>Fetch the answer&apos;s head and stand on it:</p>
          {lines.fetch.map((line) => (
            <CommandLine command={line} key={line} />
          ))}
        </li>
        <li className="flex flex-col gap-2">
          <p>
            Commit your changes on top, then push them onto the answer&apos;s
            fork:
          </p>
          <CommandLine command={lines.push} />
        </li>
        <li className="flex flex-col gap-2">
          <p>
            Hand the finish to the gate. It is checked again, and lands with you
            as <span className="font-mono">Finished-by</span>:
          </p>
          <CommandLine command={lines.finish} />
        </li>
      </ol>
      <p className="text-muted-foreground text-sm">
        To land the answer as it is, accept the decision instead.
      </p>
    </section>
  );
};

export const FinishView = ({
  ask,
  decision,
  diff = inBrowser,
  platformUrl,
  verdict,
}: {
  readonly decision: FinishDecision;
  readonly ask?: Ask | undefined;
  readonly verdict?: Verdict | undefined;
  readonly platformUrl: string;
  /** How the diff is drawn: in the browser by default; a test draws it in place. */
  readonly diff?: (patch: string) => ReactNode;
}) => {
  const patch = patchOf(decision);

  return (
    <>
      {ask === undefined ? null : <Want ask={ask} />}
      {verdict === undefined ? null : <VerdictPart verdict={verdict} />}
      {Option.isSome(patch) ? <Diff diff={diff} patch={patch.value} /> : null}
      <Lines decision={decision} platformUrl={platformUrl} verdict={verdict} />
    </>
  );
};
