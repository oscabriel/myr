import { useAtom, useAtomMount, useAtomValue } from "@effect/atom-react";
import type { Decision } from "@repo/protocol/domain/decision";
import {
  createFileRoute,
  getRouteApi,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";
import type { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { decideAtom } from "../../../../client/decide.ts";
import { projectEventsAtom } from "../../../../client/events.ts";
import { watchAtom } from "../../../../client/watch.ts";
import { hereOf } from "../../../../features/auth/session-slot.tsx";
import { useCodeFileKeys } from "../../../../features/code/file-keys.ts";
import { parseDiffHash } from "../../../../features/code/line-hash.ts";
import { SPLIT_QUERY, useMedia } from "../../../../features/code/media.ts";
import { diffAnchor } from "../../../../features/code/paths.ts";
import type { DecideInput } from "../../../../features/decision/decision-card.tsx";
import { DecisionView } from "../../../../features/decision/decision-page.tsx";
import {
  DecisionPageData,
  DecisionRead,
  newerThan,
  readDecision,
} from "../../../../features/decision/read.ts";
import type { FoundDecision } from "../../../../features/decision/read.ts";
import { patchFiles } from "../../../../features/finish/files.ts";
import { FinishFilesButton } from "../../../../features/finish/finish-files-button.tsx";
import { FinishRail } from "../../../../features/finish/finish-rail.tsx";
import { FinishView } from "../../../../features/finish/finish-view.tsx";
import {
  isFinishDecision,
  patchOf,
  waiverPatchOf,
} from "../../../../features/finish/patch.ts";
import type { FinishDecision } from "../../../../features/finish/patch.ts";
import {
  marksKey,
  useReadMarks,
} from "../../../../features/finish/read-marks.ts";
import { ProposalFailure } from "../../../../features/proposal/failure.tsx";
import { pageHead } from "../../../../features/shared/head.ts";
import { personalPage } from "../../../../server/cache-headers.ts";
import { serverClient } from "../../../../server/client.ts";

// The decision comes from `today` alone: someone who decides nothing there sees no evidence.

const root = getRouteApi("__root__");

interface DecisionParams {
  readonly project: string;
  readonly decision: string;
}

const decisionPage = createServerFn({ method: "GET" })
  .validator((params: DecisionParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(
      readDecision(data).pipe(Effect.provide(serverClient(env, getRequest())))
    )
  );

const foundOf = (read: DecisionRead): Option.Option<FoundDecision> =>
  DecisionRead.guards.Found(read) ? Option.some(read) : Option.none();

const finishOf = (read: DecisionRead) =>
  Option.flatMap(foundOf(read), (found) =>
    isFinishDecision(found.decision)
      ? Option.some({ decision: found.decision, found })
      : Option.none()
  );

const takenHere = (
  decided: AsyncResult.AsyncResult<{ readonly decision: Decision }, unknown>,
  decision: Decision
) =>
  Option.getOrUndefined(
    Option.filter(
      Option.map(AsyncResult.value(decided), (taken) => taken.decision),
      (taken) =>
        taken.id === decision.id &&
        taken.project === decision.project &&
        taken.decided !== undefined
    )
  );

const Finish = ({
  busy,
  decision,
  failure,
  found,
  now,
  onDecide,
  taken,
}: {
  readonly decision: FinishDecision;
  readonly found: FoundDecision;
  readonly now: DateTime.Utc;
  readonly onDecide: (input: DecideInput) => void;
  readonly busy: boolean;
  readonly taken: Decision | undefined;
  readonly failure: ReactNode;
}) => {
  const { platformUrl } = root.useLoaderData();
  const router = useRouter();
  const { ask, head } = decision.subject;

  useAtomMount(watchAtom(decision.project));
  const events = useAtomValue(projectEventsAtom(decision.project));

  const newerHead =
    found.newerHead ??
    Option.getOrUndefined(
      Option.flatMapNullishOr(AsyncResult.value(events), (all) =>
        newerThan(all, ask, head)
      )
    );

  const files = useMemo(
    () =>
      Option.match(patchOf(decision), {
        onNone: () => [],
        onSome: (patch) =>
          patchFiles(
            patch,
            found.ask?.territory.paths ?? [],
            `${decision.project}/${decision.id}/${head}`
          ),
      }),
    [decision, found.ask, head]
  );

  const marked = useMemo(
    () => files.map(({ file, patchId }) => ({ patchId, path: file.path })),
    [files]
  );

  const { mark, read } = useReadMarks(
    marksKey(decision.project, decision.id),
    head,
    marked
  );

  const [chosen, setChosen] = useState(false);
  const roomy = useMedia(SPLIT_QUERY);
  const split = chosen && roomy;

  const defaults = useMemo(
    () =>
      new Set(
        files.filter(({ folded }) => folded).map(({ file }) => file.path)
      ),
    [files]
  );

  const [folded, setFolded] = useState<ReadonlySet<string>>(defaults);

  const onFold = useCallback((path: string, fold: boolean) => {
    setFolded((was) => {
      if (was.has(path) === fold) {
        return was;
      }

      const next = new Set(was);

      if (fold) {
        next.add(path);
      } else {
        next.delete(path);
      }

      return next;
    });
  }, []);

  const current = useLocation({
    select: ({ hash }) =>
      Option.getOrUndefined(
        Option.map(parseDiffHash(hash), ({ path }) => path)
      ),
  });

  const paths = useMemo(() => files.map(({ file }) => file.path), [files]);

  useCodeFileKeys(paths, current, (path) => {
    Effect.runFork(
      Effect.tryPromise(() =>
        router.navigate({
          hash: diffAnchor(path),
          replace: true,
          resetScroll: false,
          to: ".",
        })
      ).pipe(Effect.ignore)
    );
  });

  return (
    <FinishView
      ask={found.ask}
      busy={busy}
      decision={
        taken === undefined ? decision : { ...taken, subject: decision.subject }
      }
      draw
      failure={failure}
      files={files}
      filesButton={<FinishFilesButton />}
      folded={folded}
      newerHead={newerHead}
      now={now}
      onDecide={onDecide}
      onFold={onFold}
      onFoldAll={(fold) => {
        setFolded(fold ? new Set(paths) : new Set());
      }}
      onMark={mark}
      onSplit={setChosen}
      placed={found.placed}
      platformUrl={platformUrl}
      read={read}
      soon={found.soon}
      split={split}
      stamp={taken !== undefined}
      verdict={found.verdict}
    />
  );
};

const DecisionPage = () => {
  const loaded = Route.useLoaderData();

  const data = useMemo(
    () => Schema.decodeSync(DecisionPageData)(loaded),
    [loaded]
  );

  const [decided, decide] = useAtom(decideAtom);
  const here = useLocation({ select: hereOf });

  const failure = AsyncResult.isFailure(decided) ? (
    <ProposalFailure
      cause={decided.cause}
      doing="take this decision"
      here={here}
    />
  ) : undefined;

  const waiverFiles = useMemo(
    () =>
      Option.getOrElse(
        Option.flatMap(foundOf(data.read), ({ decision }) =>
          Option.map(waiverPatchOf(decision), (patch) =>
            patchFiles(patch, [], `${decision.project}/${decision.id}`)
          )
        ),
        () => []
      ),
    [data.read]
  );

  const found = finishOf(data.read);

  const finish = Option.isSome(found) ? (
    <Finish
      busy={decided.waiting}
      decision={found.value.decision}
      failure={failure}
      found={found.value.found}
      now={data.now}
      onDecide={decide}
      taken={takenHere(decided, found.value.decision)}
    />
  ) : undefined;

  return (
    <DecisionView
      busy={decided.waiting}
      data={data}
      failure={failure}
      files={waiverFiles}
      finish={finish}
      here={here}
      onDecide={decide}
      taken={Option.getOrUndefined(
        Option.flatMapNullishOr(foundOf(data.read), ({ decision }) =>
          takenHere(decided, decision)
        )
      )}
    />
  );
};

export const Route = createFileRoute("/$owner/$project/decisions/$decision")({
  staticData: { rail: FinishRail },
  loader: ({ params }) => decisionPage({ data: params }),
  headers: () => personalPage,
  head: ({ params }) =>
    pageHead({ title: `Decision ${params.decision} · ${params.project}` }),
  component: DecisionPage,
});
