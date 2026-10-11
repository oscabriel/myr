import { Client } from "@repo/protocol/contracts";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { useCallback, useMemo, useState } from "react";

import { commitOf, projectOf } from "../../../../features/code/address.ts";
import { ClientDiffs } from "../../../../features/code/client-code.tsx";
import { CommitView } from "../../../../features/code/commit-view.tsx";
import { drawnFiles } from "../../../../features/code/diff-model.ts";
import { PANE_SCROLLER } from "../../../../features/code/diff-pane.tsx";
import { SPLIT_QUERY, useMedia } from "../../../../features/code/media.ts";
import { CodeNotFound } from "../../../../features/code/not-found.tsx";
import { PlainDiff } from "../../../../features/code/plain-diff.tsx";
import { prerenderedPaths } from "../../../../features/code/prerender.ts";
import { pageHead } from "../../../../features/shared/head.ts";
import { notFoundFor } from "../../../../features/shared/refusals.ts";
import { branchPage } from "../../../../server/cache-headers.ts";
import { serverClient } from "../../../../server/client.ts";
import { CommitRail } from "../tree/-code-rail.tsx";
import { CommitPageData } from "../tree/-commit-files.ts";
import { FilesButton } from "../tree/-files-button.tsx";

// One commit and what it changed, read on the server, with the territory
// of the ask it answered (the diff's stats split by it): the page arrives
// with the landing and the diff, its first files highlighted where the
// server highlights them (`features/code/prerender.ts`) and the rest as
// plain text, and the browser's drawing then takes its place, the changed
// files as a tree in the rail. A commit never
// changes, but its page carries its landing, which the project records
// after main has moved, and times reckoned from the read: a browser keeps
// it briefly, as a page at `main`. Within a visit the router keeps what it
// read, so a change of layout never reads the diff again.

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
  const loaded = Route.useLoaderData();

  // Decoded once per read: the diff's files keep one identity while the
  // reader folds, splits and moves, so nothing is parsed or drawn again.
  const { diff, now, project, territory } = useMemo(
    () => Schema.decodeSync(CommitPageData)(loaded),
    [loaded]
  );

  const router = useRouter();
  const asked = Route.useSearch().style === "split";
  const [chosen, setChosen] = useState(asked);
  const roomy = useMedia(SPLIT_QUERY);
  // Split only where the screen has room for two sides.
  const split = chosen && roomy;

  // Each file parsed once for the page: the head's stats, the plain text
  // and the folds all read this.
  const drawn = useMemo(() => drawnFiles(diff.files), [diff.files]);

  // The files the server sends highlighted: the same on both sides, since
  // both decide from the diff alone.
  const prerendered = useMemo(() => prerenderedPaths(drawn), [drawn]);

  const defaults = useMemo(
    () =>
      new Set(
        drawn.filter(({ folded }) => folded).map(({ file }) => file.path)
      ),
    [drawn]
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
                  drawn={drawn}
                  files={diff.files}
                  folded={folded}
                  onFold={onFold}
                  prerendered={prerendered}
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
      drawn={drawn}
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

export const Route = createFileRoute("/$owner/$project/commit/$sha")({
  staticData: { rail: CommitRail },
  // The router writes back what this returns, dropping only `undefined`,
  // so a unified diff's address carries no `style`.
  validateSearch: (search: { readonly style?: unknown }) => ({
    style: search.style === "split" ? ("split" as const) : undefined,
  }),
  loader: ({ params }) => {
    const page = commitPage({ data: params });

    // A document's first files are highlighted on the server before the
    // page renders, so the render waits for nothing and sends them so.
    // Imported here, not at the top: a loader stays in the chunks every
    // page preloads, and the browser's build drops this branch whole.
    // A failed read rejects as it would have (the router's not-found).
    return import.meta.env.SSR
      ? Effect.runPromise(
          Effect.gen(function* () {
            const data = yield* Effect.promise(() => page);

            const decoded = yield* Schema.decodeEffect(CommitPageData)(
              data
            ).pipe(Effect.option);

            if (Option.isSome(decoded) && !decoded.value.diff.truncated) {
              const { drawDiffAhead } = yield* Effect.promise(
                () => import("../../../../features/code/prerender.ts")
              );

              yield* Effect.promise(() =>
                drawDiffAhead(decoded.value.diff.files)
              );
            }

            return data;
          })
        )
      : page;
  },
  // The diff never changes: a layout change (`?style=split`) rewrites the
  // address, and must not read it again.
  staleTime: Number.POSITIVE_INFINITY,
  headers: () => branchPage,
  head: ({ params: { project, sha } }) =>
    pageHead({ title: `${project}: commit ${sha.slice(0, 7)}` }),
  component: CommitPage,
  notFoundComponent: CodeNotFound,
});
