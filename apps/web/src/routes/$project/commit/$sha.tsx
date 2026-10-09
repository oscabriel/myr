import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../../features/shared/layout.tsx";
import { NotBuilt } from "../../../features/shared/not-built.tsx";

// One commit: its message, its people, its landing and its diff. A stub until 904 builds it.

const Page = () => {
  const { project, sha } = Route.useParams();

  return (
    <NotBuilt
      current="code"
      issue="904"
      project={project}
      title={`${project}: commit ${sha.slice(0, 7)}`}
    />
  );
};

export const Route = createFileRoute("/$project/commit/$sha")({
  component: Page,
  head: ({ params: { project, sha } }) => ({
    meta: [{ title: pageTitle(`${project}: commit ${sha.slice(0, 7)}`) }],
  }),
});
