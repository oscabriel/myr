import { useAtom, useAtomMount, useAtomValue } from "@effect/atom-react";
import { Client, ShowProposal } from "@repo/protocol/contracts";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Today } from "@repo/protocol/domain/decision";
import type { Proposal } from "@repo/protocol/domain/proposal";
import { ProjectName, ProposalId } from "@repo/protocol/ids";
import type { DecisionId, Handle } from "@repo/protocol/ids";
import { createFileRoute, notFound, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Array, DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import {
  draftAtom,
  projectTodayAtom,
  proposalAtom,
} from "../../../client/proposal.ts";
import { SeededAtoms, seedSuccess } from "../../../client/seeded.ts";
import { watchAtom } from "../../../client/watch.ts";
import { NotFoundView } from "../../../features/ask/refused.tsx";
import { hereOf } from "../../../features/auth/session-slot.tsx";
import { whoAtom } from "../../../features/auth/who.ts";
import { ProposalFailure } from "../../../features/proposal/failure.tsx";
import { ProposalView } from "../../../features/proposal/proposal-view.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { notFoundFor, Refusals } from "../../../features/shared/refusals.ts";
import { personalPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";

// `/$project/proposals/$proposal`: one proposal and the platform's draft of
// its ask. The loader reads `showProposal` on the server, so the page
// arrives whole and an address naming no project or proposal is a 404; in
// the browser it reads again on each `ProposalDrafted` (the project's
// watch), so a draft moves from Drafting to Ready or Failed on screen.
// Who is signed in and the reader's Today (a decider's: it holds the open
// decision on the proposal) are read in the browser only.

type Shown = typeof ShowProposal.successSchema.Type;

/** The proposal `name/id` names, encoded for the page; a not-found when there is none. */
export const readProposal = (name: string, id: string) =>
  Effect.gen(function* () {
    const project = yield* Schema.decodeEffect(ProjectName)(name).pipe(
      Effect.mapError(() => notFound())
    );

    const proposal = yield* Schema.decodeEffect(ProposalId)(id).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const shown = yield* client.showProposal({ project, proposal }).pipe(
      Effect.catchTags({
        UnknownProject: notFoundFor,
        UnknownProposal: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(ShowProposal.successSchema)(shown);
  });

const proposalPage = createServerFn({ method: "GET" })
  .validator(
    (params: { readonly project: string; readonly proposal: string }) => params
  )
  .handler(({ data }) =>
    Effect.runPromise(
      readProposal(data.project, data.proposal).pipe(
        Effect.provide(serverClient(env))
      )
    )
  );

/** The open decision on `proposal` in the reader's Today, if it is there. */
const decisionOn = (
  today: AsyncResult.AsyncResult<Today, unknown>,
  proposal: Proposal
): Option.Option<DecisionId> =>
  Option.flatMap(AsyncResult.value(today), ({ decisions }) =>
    Array.findFirst(
      decisions,
      ({ decided, project, subject }) =>
        decided === undefined &&
        project === proposal.project &&
        DecisionSubject.guards.OpenProposal(subject) &&
        subject.proposal === proposal.id
    ).pipe(Option.map(({ id }) => id))
  );

/** Whether `who` is the proposer, or the reader decides in the project (their Today answered). */
const mayRedraftAs = (
  who: AsyncResult.AsyncResult<Option.Option<Handle>, unknown>,
  today: AsyncResult.AsyncResult<Today, unknown>,
  proposal: Proposal
) =>
  AsyncResult.isSuccess(today) ||
  Option.exists(
    Option.flatten(AsyncResult.value(who)),
    (handle) => handle.toLowerCase() === proposal.proposer.toLowerCase()
  );

/** The page over the proposal's atom, which starts from what the loader read. */
const FreshProposal = ({
  project,
  read,
}: {
  readonly project: ProjectName;
  readonly read: Shown;
}) => {
  // Live: a `ProposalDrafted` re-reads the proposal.
  useAtomMount(watchAtom(project));

  const { files, proposal } = Option.getOrElse(
    AsyncResult.value(useAtomValue(proposalAtom(project)(read.proposal.id))),
    () => read
  );

  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);
  const today = useAtomValue(projectTodayAtom(project));
  const [redrafted, redraft] = useAtom(draftAtom);

  return (
    <ProposalView
      busy={redrafted.waiting}
      now={DateTime.nowUnsafe()}
      decision={decisionOn(today, proposal)}
      files={files}
      mayRedraft={mayRedraftAs(who, today, proposal)}
      onRedraft={(note) => {
        redraft(
          note === undefined
            ? { project, proposal: proposal.id }
            : { note, project, proposal: proposal.id }
        );
      }}
      project={project}
      proposal={proposal}
    >
      {AsyncResult.isFailure(redrafted) ? (
        <div aria-live="polite">
          <ProposalFailure
            cause={redrafted.cause}
            doing="draft it again"
            here={here}
          />
        </div>
      ) : null}
    </ProposalView>
  );
};

const ProposalPage = () => {
  const read = Schema.decodeSync(ShowProposal.successSchema)(
    Route.useLoaderData()
  );

  const { id, project } = read.proposal;

  return (
    <SeededAtoms
      id={`${project}/${id}`}
      seeds={[seedSuccess(proposalAtom(project)(id), read)]}
    >
      <FreshProposal project={project} read={read} />
    </SeededAtoms>
  );
};

const decodeRefusals = Schema.decodeUnknownOption(Refusals);

/** A proposal or a project the platform does not know: its refusal, as git prints it. */
const Unknown = ({ data }: { readonly data?: unknown }) => (
  <NotFoundView
    nothing="Nothing is at this address: a project's name is lowercase words joined by single dashes, and a proposal's id reads prop- and six digits."
    refusals={Option.getOrUndefined(decodeRefusals(data))}
    title="No such proposal"
  />
);

export const Route = createFileRoute("/$project/proposals/$proposal")({
  loader: ({ params }) => proposalPage({ data: params }),
  // Who may draft it again and the decision on it are the reader's own.
  headers: () => personalPage,
  head: ({ loaderData, params: { project, proposal } }) =>
    pageHead(
      loaderData === undefined
        ? { title: `${proposal} · ${project}` }
        : {
            description: loaderData.proposal.want,
            title: `${proposal} · ${project}`,
          }
    ),
  component: ProposalPage,
  notFoundComponent: Unknown,
});
