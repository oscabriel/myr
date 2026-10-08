import { RegistryProvider, useAtomValue } from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import { Verdict } from "@repo/protocol/domain/answer";
import { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import { AskId, CommitSha, ProjectName } from "@repo/protocol/ids";
import type { LandedSha } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { landingAtom, verdictAtom } from "../../../client/answer.ts";
import { AnswerView } from "../../../features/answer/answer-page.tsx";
import { answerPath } from "../../../features/ask/ask-page.tsx";
import { CODE, LINK } from "../../../features/ask/fields.tsx";
import { NoSuchAsk, notFoundFor } from "../../../features/ask/refused.tsx";
import { PageShell, pageTitle } from "../../../features/shared/layout.tsx";
import { serverClient } from "../../../server/client.ts";

// The answer page: the latest verdict on an answer to an ask, stage by
// stage, or with `?head=<sha>` the verdict on an earlier answer. A landed
// answer shows its landing's credit trailers.

/** The page's address, not yet decoded: the path's names and `?head=`. */
interface AnswerAddress {
  readonly ask: string;
  readonly head?: string | undefined;
  readonly project: string;
}

/** The address, decoded: names the platform could hold, and a commit id. */
const AnswerPath = Schema.Struct({
  ask: AskId,
  head: Schema.optionalKey(CommitSha),
  project: ProjectName,
});

/** What the page's loader carries from the server, encoded: whose answer, its verdict and landing, and when it was read. */
const AnswerPageData = Schema.Struct({
  ...AnswerPath.fields,
  landing: Schema.UndefinedOr(LandingView),
  now: Schema.DateTimeUtcFromString,
  verdict: Schema.UndefinedOr(Verdict),
});

type AnswerPageData = typeof AnswerPageData.Type;

/** The landing a verdict's answer made, when it landed. */
const landedBy = (verdict: Verdict | undefined): LandedSha | undefined =>
  verdict !== undefined && Outcome.isAnyOf(["Landed"])(verdict.outcome)
    ? verdict.outcome.sha
    : undefined;

/** The verdict for the page and, if its answer landed, the landing; or a not-found carrying the refusal (a 404). */
export const readAnswer = ({ ask, head, project }: AnswerAddress) =>
  Effect.gen(function* () {
    const path = yield* Schema.decodeEffect(AnswerPath)(
      head === undefined ? { ask, project } : { ask, head, project }
    ).pipe(Effect.mapError(() => notFound()));

    const client = yield* Client;

    const { verdict } = yield* client.verdict(path).pipe(
      Effect.catchTags({
        UnknownAsk: notFoundFor,
        UnknownProject: notFoundFor,
      })
    );

    const sha = landedBy(verdict);

    const landing =
      sha === undefined
        ? Option.none()
        : yield* client.landing({ project: path.project, sha }).pipe(
            Effect.map((found) => Option.some(found.landing)),
            // The verdict names a landing the platform no longer finds: show the verdict alone.
            Effect.catchTag("UnknownCommit", () => Effect.succeedNone)
          );

    return yield* Schema.encodeEffect(AnswerPageData)({
      ...path,
      landing: Option.getOrUndefined(landing),
      now: yield* DateTime.now,
      verdict,
    });
  });

const answerPage = createServerFn({ method: "GET" })
  .validator((address: AnswerAddress) => address)
  .handler(({ data }) =>
    Effect.runPromise(readAnswer(data).pipe(Effect.provide(serverClient(env))))
  );

/** The verdict with its landing's trailers, from the landing's atom (seeded when the loader read it). */
const LandedAnswer = ({
  now,
  project,
  seeded,
  sha,
  verdict,
}: {
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly seeded: LandingView | undefined;
  readonly sha: LandedSha;
  readonly verdict: Verdict;
}) => {
  const fresh = Option.map(
    AsyncResult.value(useAtomValue(landingAtom(project, sha))),
    (found) => found.landing
  );

  const landing = Option.getOrElse(fresh, () =>
    seeded?.sha === sha ? seeded : undefined
  );

  return landing === undefined ? (
    <AnswerView now={now} verdict={verdict} />
  ) : (
    <AnswerView landing={landing} now={now} verdict={verdict} />
  );
};

/** The page over the verdict's atom, which starts from what the loader read and refetches when its keys change. */
const FreshAnswer = ({
  atom,
  read,
}: {
  readonly atom: ReturnType<typeof verdictAtom>;
  readonly read: AnswerPageData;
}) => {
  const { verdict } = Option.getOrElse(
    AsyncResult.value(useAtomValue(atom)),
    () => read
  );

  const sha = landedBy(verdict);

  return verdict === undefined || sha === undefined ? (
    <AnswerView now={read.now} verdict={verdict} />
  ) : (
    <LandedAnswer
      now={read.now}
      project={read.project}
      seeded={read.landing}
      sha={sha}
      verdict={verdict}
    />
  );
};

const AnswerPage = () => {
  const read = Schema.decodeSync(AnswerPageData)(Route.useLoaderData());
  const { ask, head, landing, project, verdict } = read;
  const atom = verdictAtom(project, ask, head);

  const seeds = [
    Atom.initialValue(
      atom,
      AsyncResult.success(verdict === undefined ? {} : { verdict })
    ),
    ...(landing === undefined
      ? []
      : [
          Atom.initialValue(
            landingAtom(project, landing.sha),
            AsyncResult.success({ landing })
          ),
        ]),
  ];

  return (
    <PageShell title={`Answer to ${ask}`}>
      {head === undefined ? null : (
        <p className="text-sm">
          An earlier answer, at <code className={CODE}>{head.slice(0, 7)}</code>
          .{" "}
          <a className={LINK} href={answerPath(project, ask)}>
            The latest answer
          </a>
        </p>
      )}
      <RegistryProvider
        initialValues={seeds}
        key={`${project}/${ask}/${head ?? ""}`}
      >
        <FreshAnswer atom={atom} read={read} />
      </RegistryProvider>
    </PageShell>
  );
};

/** An address with no refusal behind it: a name that can name nothing, or a `?head=` that is no commit id. */
const NOTHING =
  "Nothing is at this address: a project's and an ask's names are lowercase words joined by single dashes, and ?head= takes an answer's whole commit id, 40 hex digits.";

const AnswerNotFound = ({ data }: { readonly data?: unknown }) => (
  <NoSuchAsk data={data} nothing={NOTHING} />
);

export const Route = createFileRoute("/$project/answers/$ask")({
  // TanStack infers each option from the ones before it, so the search comes
  // before the loader that reads it.
  validateSearch: ({ head }: { readonly head?: unknown }) =>
    Predicate.isString(head) ? { head } : {},
  loaderDeps: ({ search }) => ({ head: search.head }),
  loader: ({ deps, params }) => answerPage({ data: { ...params, ...deps } }),
  head: ({ params }) => ({
    meta: [{ title: pageTitle(`Answer to ${params.ask}`) }],
  }),
  component: AnswerPage,
  notFoundComponent: AnswerNotFound,
});
