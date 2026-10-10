import { docEntry } from "@repo/agent-kit/docs/entries";
import { docPage, docPages } from "@repo/agent-kit/docs/index";
import {
  createFileRoute,
  getRouteApi,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { Effect, Option } from "effect";

import { commands } from "../../features/agents/catalog.ts";
import { DocsPageView } from "../../features/docs/docs-view.tsx";
import { docsHead, docsMarkdownPath } from "../../features/docs/head.ts";
import { markdownLink } from "../../features/front/markdown.ts";
import { branchPage } from "../../server/cache-headers.ts";

// `/docs/<page>`: one guide or reference page, written for this stage's
// platform and the web's own origin, with its Markdown at
// `/docs/<page>.md`. The same for every reader, and it changes only with a
// deploy.

const root = getRouteApi("__root__");

const DocsPage = () => {
  const { page: slug } = Route.useParams();
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();
  const input = { commands, platformUrl, webUrl: origin };

  return Option.match(docPage(input, slug), {
    onNone: () => null,
    onSome: (page) => <DocsPageView page={page} pages={docPages(input)} />,
  });
};

export const Route = createFileRoute("/docs/$page")({
  // A page the docs don't have is the router's not-found.
  loader: ({ params }) =>
    Effect.runPromise(
      Option.isSome(docEntry(params.page))
        ? Effect.void
        : Effect.fail(notFound())
    ),
  component: DocsPage,
  headers: ({ params }) => ({
    ...branchPage,
    link: markdownLink(docsMarkdownPath(params.page)),
  }),
  head: ({ params }) =>
    Option.match(docEntry(params.page), {
      onNone: () => ({}),
      onSome: docsHead,
    }),
});
