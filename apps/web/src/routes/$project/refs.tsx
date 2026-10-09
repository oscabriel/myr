import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../features/shared/layout.tsx";
import { NotBuilt } from "../../features/shared/not-built.tsx";

// Main, the tags and the forks. A stub until 904 builds it.

const Page = () => {
  const { project } = Route.useParams();

  return (
    <NotBuilt
      current="refs"
      issue="904"
      project={project}
      title={`${project}: refs`}
    />
  );
};

export const Route = createFileRoute("/$project/refs")({
  component: Page,
  head: ({ params: { project } }) => ({
    meta: [{ title: pageTitle(`${project}: refs`) }],
  }),
});
