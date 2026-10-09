import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../../features/shared/layout.tsx";
import { NotBuilt } from "../../../features/shared/not-built.tsx";

// The propose form: a want, for the platform's agent to draft into an ask. A stub until 911 builds it.

const Page = () => {
  const { project } = Route.useParams();

  return (
    <NotBuilt
      issue="911"
      project={project}
      title={`${project}: propose an ask`}
    />
  );
};

export const Route = createFileRoute("/$project/proposals/new")({
  component: Page,
  head: ({ params: { project } }) => ({
    meta: [{ title: pageTitle(`${project}: propose an ask`) }],
  }),
});
