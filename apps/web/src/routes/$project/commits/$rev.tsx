import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../../features/shared/layout.tsx";
import { NotBuilt } from "../../../features/shared/not-built.tsx";

// The log at a revision, grouped by day, each landing with its ask and credit. A stub until 904 builds it.

const Page = () => {
  const { project, rev } = Route.useParams();

  return (
    <NotBuilt
      current="landings"
      issue="904"
      project={project}
      title={`${project}: landings on ${rev}`}
    />
  );
};

export const Route = createFileRoute("/$project/commits/$rev")({
  component: Page,
  head: ({ params: { project, rev } }) => ({
    meta: [{ title: pageTitle(`${project}: landings on ${rev}`) }],
  }),
});
