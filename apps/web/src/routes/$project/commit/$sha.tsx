import { Client } from "@repo/protocol/contracts";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { useCallback, useMemo, useState } from "react";

import { commitOf, projectOf } from "../../../features/code/address.ts";
import { ClientDiffs } from "../../../features/code/client-code.tsx";
import { CommitView } from "../../../features/code/commit-view.tsx";
import { drawnFiles } from "../../../features/code/diff-model.ts";
import { PANE_SCROLLER } from "../../../features/code/diff-pane.tsx";
import { SPLIT_QUERY, useMedia } from "../../../features/code/media.ts";
import { CodeNotFound } from "../../../features/code/not-found.tsx";
import { PlainDiff } from "../../../features/code/plain-diff.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { notFoundFor } from "../../../features/shared/refusals.ts";
import { immutablePage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";
import { CommitRail } from "../tree/-code-rail.tsx";
import { CommitPageData } from "../tree/-commit-files.ts";
import { FilesButton } from "../tree/-files-button.tsx";

// One commit and what it changed, read on the server, with the territory
// of the ask it answered (the diff's stats split by it): the page arrives
// with the landing and the diff as plain text, and the browser draws the
// diff over it, the changed files as a tree in the rail. A commit never
// changes, so neither does its page: it is kept for good, and the router
// never reads it again.

interface CommitParams {
  readonly project: string;
  readonly sha: string;
}

/** The commit for its page, or a not-found carrying the platform's refusal. */
export const readCommitPage = (params: CommitParams) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(params.project));
    const sha = yield* Effect.fromOption(commitOf(params.sha));
    const client = yield* Client;

    const diff = yield* client.showCommit({ project, sha }).pipe(
      Effect.catchTags({
        UnknownCommit: notFoundFor,
        UnknownProject: notFoundFor,
      })
    );

    // The ask the landing answered, for its territory; a page without it
    // splits its stats into tests and the rest.
    const answered = Option.fromUndefinedOr(diff.commit.landing?.ask);

    const territory = Option.isNone(answered)
      ? Option.none()
      : yield* client.showAsk({ ask: answered.value, project }).pipe(
          Effect.map(({ ask }) => ask.territory.paths),
          Effect.option
        );

    return yield* Schema.encodeEffect(CommitPageData)({
      diff,
      now: yield* DateTime.now,
      project,
      ...Option.match(territory, {
        onNone: () => ({}),
        onSome: (paths) => ({ territory: paths }),
      }),
    });
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const commitPage = createServerFn({ method: "GET" })
  .validator((params: CommitParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(
      readCommitPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const CommitPage = () => {
  const { diff, now, project, territory } = Schema.decodeSync(CommitPageData)(
    Route.useLoaderData()
  );

  const router = useRouter();
  const asked = Route.useSearch().style === "split";
  const [chosen, setChosen] = useState(asked);
  const roomy = useMedia(SPLIT_QUERY);
  // Split only where the screen has room for two sides.
  const split = chosen && roomy;

  const defaults = useMemo(
    () =>
      new Set(
        drawnFiles(diff.files)
          .filter(({ folded }) => folded)
          .map(({ file }) => file.path)
      ),
    [diff.files]
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

  const onFoldAll = useCallback(
    (fold: boolean) => {
      setFolded(fold ? new Set(diff.files.map(({ path }) => path)) : new Set());
    },
    [diff.files]
  );

  // The layout is the reader's: kept in the address, with no read again.
  const onSplit = (next: boolean) => {
    setChosen(next);

    const { hash, pathname } = router.state.location;

    router.history.replace(
      `${pathname}${next ? "?style=split" : ""}${hash === "" ? "" : `#${hash}`}`
    );
  };

  return (
    <CommitView
      diff={diff}
      drawing={
        diff.truncated ? undefined : (
          <ClientDiffs
            fallback={
              <div className={PANE_SCROLLER}>
                <PlainDiff
                  files={diff.files}
                  folded={folded}
                  onFold={onFold}
                  split={split}
                />
              </div>
            }
            files={diff.files}
            folded={folded}
            onFold={onFold}
            split={split}
          />
        )
      }
      files={<FilesButton commit />}
      folded={folded}
      now={now}
      onFold={onFold}
      onFoldAll={onFoldAll}
      onSplit={onSplit}
      project={project}
      split={split}
      territory={territory}
    />
  );
};

export const Route = createFileRoute("/$project/commit/$sha")({
  staticData: { rail: CommitRail },
  // The router writes back what this returns, dropping only `undefined`,
  // so a unified diff's address carries no `style`.
  validateSearch: (search: { readonly style?: unknown }) => ({
    style: search.style === "split" ? ("split" as const) : undefined,
  }),
  loader: ({ params }) => commitPage({ data: params }),
  // A commit never changes: what was read stays fresh for good.
  staleTime: Number.POSITIVE_INFINITY,
  headers: () => immutablePage,
  head: ({ params: { project, sha } }) =>
    pageHead({ title: `${project}: commit ${sha.slice(0, 7)}` }),
  component: CommitPage,
  notFoundComponent: CodeNotFound,
});
