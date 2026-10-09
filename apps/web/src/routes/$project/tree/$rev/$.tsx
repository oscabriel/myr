import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../../../features/shared/layout.tsx";
import { NotBuilt } from "../../../../features/shared/not-built.tsx";

// A directory at a revision: breadcrumb, file tree, entries and its README. A stub until 904 builds it.

const Page = () => {
  const { project, rev } = Route.useParams();

  return (
    <NotBuilt
      current="code"
      issue="904"
      project={project}
      title={`${project}: code at ${rev}`}
    />
  );
};

export const Route = createFileRoute("/$project/tree/$rev/$")({
  component: Page,
  head: ({ params: { project, rev } }) => ({
    meta: [{ title: pageTitle(`${project}: code at ${rev}`) }],
  }),
});
