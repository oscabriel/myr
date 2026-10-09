import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../../features/shared/layout.tsx";
import { NotBuilt } from "../../../features/shared/not-built.tsx";

// A proposal: its draft, the drafted files and the red-first evidence. A stub until 911 builds it.

const Page = () => {
  const { project, proposal } = Route.useParams();

  return (
    <NotBuilt
      issue="911"
      project={project}
      title={`${project}: proposal ${proposal}`}
    />
  );
};

export const Route = createFileRoute("/$project/proposals/$proposal")({
  component: Page,
  head: ({ params: { project, proposal } }) => ({
    meta: [{ title: pageTitle(`${project}: proposal ${proposal}`) }],
  }),
});
