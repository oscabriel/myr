import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../../../features/shared/layout.tsx";
import { NotBuilt } from "../../../../features/shared/not-built.tsx";

// A file at a revision: highlighted, with line anchors, raw, why and history. A stub until 904 builds it.

const Page = () => {
  const { _splat, project } = Route.useParams();

  return (
    <NotBuilt
      current="code"
      issue="904"
      project={project}
      title={`${project}: ${_splat ?? ""}`}
    />
  );
};

export const Route = createFileRoute("/$project/blob/$rev/$")({
  component: Page,
  head: ({ params: { _splat, project } }) => ({
    meta: [{ title: pageTitle(`${project}: ${_splat ?? ""}`) }],
  }),
});
