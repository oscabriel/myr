import { useAtom, useAtomValue } from "@effect/atom-react";
import { Brand } from "@repo/brand";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import { DecisionId, ProjectName } from "@repo/protocol/ids";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DateTime, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import {
  decideAtom,
  finishAskAtom,
  finishVerdictAtom,
} from "../../../client/decide.ts";
import { todayAtom } from "../../../client/today.ts";
import { DecisionCard } from "../../../features/decision/decision-card.tsx";
import type { DecideInput } from "../../../features/decision/decision-card.tsx";
import { FinishView } from "../../../features/finish/finish-view.tsx";
import type { FinishDecision } from "../../../features/finish/finish-view.tsx";
import { EmptyState } from "../../../features/shared/empty.tsx";
import { PageShell, pageTitle } from "../../../features/shared/layout.tsx";
import {
  DecidedNotice,
  FailureView,
  findDecision,
  ReadingToday,
} from "../../../features/today/today-page.tsx";

// `/$project/decisions/$decision`: one decision from the decider's Today in
// that project; for a `Finish`, the answer's diff, its ask and verdict, and
// the lines that finish it. The decision comes from `today` alone: someone
// who decides nothing there gets `NotDecider`, and no other read fetches a
// decision or a diff. Read in the browser, as Today is.

const root = getRouteApi("__root__");

const projectOf = Schema.decodeUnknownOption(ProjectName);

const decisionOf = Schema.decodeUnknownOption(DecisionId);

const isFinish = (decision: Decision): decision is FinishDecision =>
  DecisionSubject.isAnyOf(["Finish"])(decision.subject);

/** The ask and verdict a finish shows beside its diff, as they arrive. */
const Finish = ({ decision }: { readonly decision: FinishDecision }) => {
  const { platformUrl } = root.useLoaderData();
  const { ask, head } = decision.subject;
  const shown = useAtomValue(finishAskAtom(decision.project, ask));
  const judged = useAtomValue(finishVerdictAtom(decision.project, ask, head));

  return (
    <FinishView
      ask={Option.getOrUndefined(AsyncResult.value(shown))?.ask}
      decision={decision}
      platformUrl={platformUrl}
      verdict={Option.getOrUndefined(AsyncResult.value(judged))?.verdict}
    />
  );
};

const NotOnToday = ({ decision }: { readonly decision: string }) => (
  <EmptyState
    command={`${Brand.cli} today`}
    title={`Decision ${decision} is not on your Today: it was decided, it expired to its default, or it waits beyond today's budget.`}
  />
);

/** The decision named, as the decider's Today in its project has it. */
const Found = ({
  busy,
  id,
  onDecide,
  project,
  today,
}: {
  readonly busy: boolean;
  readonly id: DecisionId;
  readonly onDecide: (input: DecideInput) => void;
  readonly project: ProjectName;
  readonly today: AsyncResult.AsyncResult<Today, unknown>;
}) => {
  if (AsyncResult.isFailure(today)) {
    return <FailureView cause={today.cause} />;
  }

  if (AsyncResult.isInitial(today)) {
    return <ReadingToday />;
  }

  const found = findDecision(today.value, project, id);

  if (Option.isNone(found)) {
    return <NotOnToday decision={id} />;
  }

  const { decision, soon } = found.value;

  // A finish is read whole (want, verdict, diff, the lines) before its
  // choices, which end the page.
  return (
    <DecisionCard
      busy={busy}
      decision={decision}
      now={DateTime.nowUnsafe()}
      onDecide={onDecide}
      soon={soon}
      standalone
    >
      {isFinish(decision) ? <Finish decision={decision} /> : undefined}
    </DecisionCard>
  );
};

/** One project's Today, read for the decision page. */
const InProject = ({
  id,
  project,
}: {
  readonly id: DecisionId;
  readonly project: ProjectName;
}) => {
  const today = useAtomValue(todayAtom(project));
  const [decided, decide] = useAtom(decideAtom);

  return (
    <>
      <div aria-live="polite">
        <DecidedNotice decided={decided} />
      </div>
      <Found
        busy={decided.waiting}
        id={id}
        onDecide={decide}
        project={project}
        today={today}
      />
    </>
  );
};

const DecisionPage = () => {
  const params = Route.useParams();
  const project = projectOf(params.project);
  const id = decisionOf(params.decision);

  return (
    <PageShell title={`Decision ${params.decision}`}>
      {Option.isSome(project) && Option.isSome(id) ? (
        <InProject id={id.value} project={project.value} />
      ) : (
        <NotOnToday decision={params.decision} />
      )}
    </PageShell>
  );
};

export const Route = createFileRoute("/$project/decisions/$decision")({
  component: DecisionPage,
  head: ({ params }) => ({
    meta: [{ title: pageTitle(`Decision ${params.decision}`) }],
  }),
  ssr: false,
});
