import { useAtomMount, useAtomValue } from "@effect/atom-react";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { Handle, LandedSha } from "@repo/protocol/ids";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { landingAtom, verdictAtom } from "../../../../client/answer.ts";
import { askAtom } from "../../../../client/ask.ts";
import { askStates, projectEventsAtom } from "../../../../client/events.ts";
import { SeededAtoms, seedSuccess } from "../../../../client/seeded.ts";
import { watchAtom } from "../../../../client/watch.ts";
import { AnswerView } from "../../../../features/answer/answer-page.tsx";
import { EvidenceLog } from "../../../../features/answer/lane-log.tsx";
import {
  AnswerPageData,
  landedBy,
  readAnswer,
} from "../../../../features/answer/reads.ts";
import type { AnswerAddress } from "../../../../features/answer/reads.ts";
import { NoSuchAsk } from "../../../../features/ask/refused.tsx";
import { whoAtom } from "../../../../features/auth/who.ts";
import { pageHead } from "../../../../features/shared/head.ts";
import { branchPage } from "../../../../server/cache-headers.ts";
import { serverClient } from "../../../../server/client.ts";

const answerPage = createServerFn({ method: "GET" })
  .validator((address: AnswerAddress) => address)
  .handler(({ data }) =>
    Effect.runPromise(readAnswer(data).pipe(Effect.provide(serverClient(env))))
  );

const noLanding = Atom.make(Option.none<LandingView>());

// One hook whether or not the answer landed, so the page keeps its place in the tree when it lands while open.
const useLanding = (
  read: AnswerPageData,
  sha: LandedSha | undefined
): LandingView | undefined => {
  const atom = useMemo(
    () =>
      sha === undefined
        ? noLanding
        : Atom.map(landingAtom(read.project, sha), (result) =>
            Option.map(AsyncResult.value(result), (found) => found.landing)
          ),
    [read.project, sha]
  );

  return Option.getOrElse(useAtomValue(atom), () =>
    sha !== undefined && read.landing?.sha === sha ? read.landing : undefined
  );
};

const FreshAnswer = ({
  read,
  viewer,
}: {
  readonly read: AnswerPageData;
  readonly viewer: Handle | undefined;
}) => {
  useAtomMount(watchAtom(read.project));

  const { verdict } = Option.getOrElse(
    AsyncResult.value(
      useAtomValue(verdictAtom(read.project, read.ask, read.head))
    ),
    () => read
  );

  const { ask } = Option.getOrElse(
    AsyncResult.value(useAtomValue(askAtom(read.project, read.ask))),
    () => ({ ask: read.askRead })
  );

  // The replay as the browser reads it, once it has; until then the
  // server's, which holds the same events about these asks.
  const events = Option.getOrElse(
    AsyncResult.value(useAtomValue(projectEventsAtom(read.project))),
    () => read.events
  );

  const states = askStates(events);
  const landed = states.get(read.ask)?.landed;

  const landing = useLanding(read, landedBy(verdict));

  return (
    <AnswerView
      ask={ask}
      head={read.head}
      landing={landing}
      LogReader={EvidenceLog}
      now={read.now}
      parent={read.parent}
      // A landing the server's read already held never stamps.
      stamp={landed !== undefined && landed.seq > read.lastSeq}
      states={states}
      verdict={verdict}
      viewer={viewer}
    />
  );
};

const AnswerPage = () => {
  const read = Schema.decodeSync(AnswerPageData)(Route.useLoaderData());
  const who = useAtomValue(whoAtom);
  const { ask, askRead, brief, head, landing, project, verdict } = read;

  const seeds = [
    seedSuccess(
      verdictAtom(project, ask, head),
      verdict === undefined ? {} : { verdict }
    ),
    seedSuccess(askAtom(project, ask), { ask: askRead, brief }),
    ...(landing === undefined
      ? []
      : [seedSuccess(landingAtom(project, landing.sha), { landing })]),
  ];

  return (
    <SeededAtoms id={`${project}/${ask}/${head ?? ""}`} seeds={seeds}>
      <FreshAnswer
        read={read}
        viewer={
          AsyncResult.isSuccess(who)
            ? Option.getOrUndefined(who.value)
            : undefined
        }
      />
    </SeededAtoms>
  );
};

const NOTHING =
  "Nothing is at this address: a project's and an ask's names are lowercase words joined by single dashes, and ?head= takes an answer's whole commit id, 40 hex digits.";

const AnswerNotFound = ({ data }: { readonly data?: unknown }) => {
  const { project } = useParams({ strict: false });

  return <NoSuchAsk data={data} nothing={NOTHING} project={project} />;
};

export const Route = createFileRoute("/$owner/$project/answers/$ask")({
  staticData: { shell: "project" },
  // TanStack infers each option from the ones before it, so the search comes
  // before the loader that reads it.
  validateSearch: ({ head }: { readonly head?: unknown }) =>
    Predicate.isString(head) ? { head } : {},
  loaderDeps: ({ search }) => ({ head: search.head }),
  loader: ({ deps, params }) => answerPage({ data: { ...params, ...deps } }),
  head: ({ loaderData, params }) =>
    loaderData === undefined
      ? pageHead({ title: "No such ask" })
      : pageHead({
          description: loaderData.askRead.brief.want,
          title: `Answer to ${params.ask} · ${params.project}`,
        }),
  headers: () => branchPage,
  component: AnswerPage,
  notFoundComponent: AnswerNotFound,
});
