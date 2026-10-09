import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../features/shared/layout.tsx";
import { NotBuilt } from "../../features/shared/not-built.tsx";

// Who decides what, who is vouched for, and who reads and writes each layer. A stub until 907 builds it.

const Page = () => {
  const { project } = Route.useParams();

  return (
    <NotBuilt
      current="people"
      issue="907"
      project={project}
      title={`${project}: people`}
    />
  );
};

export const Route = createFileRoute("/$project/people")({
  component: Page,
  head: ({ params: { project } }) => ({
    meta: [{ title: pageTitle(`${project}: people`) }],
  }),
});
