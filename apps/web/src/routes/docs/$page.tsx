import { docEntry } from "@repo/agent-kit/docs/entries";
import { docPage } from "@repo/agent-kit/docs/index";
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

const root = getRouteApi("__root__");

const DocsPage = () => {
  const { page: slug } = Route.useParams();
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();
  const input = { commands, platformUrl, webUrl: origin };

  return Option.match(docPage(input, slug), {
    onNone: () => null,
    onSome: (page) => <DocsPageView page={page} />,
  });
};

export const Route = createFileRoute("/docs/$page")({
  staticData: { shell: "docs" },
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
