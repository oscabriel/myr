import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";

import { frontPageAtom, projectsAtom } from "../client/front.ts";
import { readFilter } from "../features/front/filter.ts";
import { FrontPageView } from "../features/front/front-page.tsx";
import { Reading, Unreachable } from "../features/front/reading.tsx";
import { pageTitle } from "../features/shared/head.ts";

// The front page: every open ask, read once, filtered here by the address's
// `?kind=` and `?reserved=` (each decoded with its schema; one that does not
// decode is dropped). The whole list is read, so the filter offers every
// kind on the platform.

const TITLE = "Open asks";

/** Every open ask, unfiltered: the page narrows it, so its filter can offer every kind. */
const everyAsk = frontPageAtom({});

const FrontPage = () => {
  const filter = Route.useSearch();

  const read = AsyncResult.all({
    front: useAtomValue(everyAsk),
    listed: useAtomValue(projectsAtom),
  });

  return AsyncResult.matchWithError(read, {
    onDefect: () => <Unreachable title={TITLE} />,
    onError: () => <Unreachable title={TITLE} />,
    onInitial: () => <Reading title={TITLE} />,
    onSuccess: ({ value: { front, listed } }) => (
      <FrontPageView
        entries={front.entries}
        filter={filter}
        now={DateTime.nowUnsafe()}
        projects={listed.projects}
      />
    ),
  });
};

export const Route = createFileRoute("/")({
  component: FrontPage,
  head: () => ({ meta: [{ title: pageTitle(TITLE) }] }),
  validateSearch: readFilter,
});
