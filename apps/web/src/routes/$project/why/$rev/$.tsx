import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "../../../../features/shared/layout.tsx";
import { NotBuilt } from "../../../../features/shared/not-built.tsx";

// A file with, above each range of lines, the landing that put it there. A stub until 912 builds it.

const Page = () => {
  const { _splat, project } = Route.useParams();

  return (
    <NotBuilt
      current="code"
      issue="912"
      project={project}
      title={`${project}: why ${_splat ?? ""}`}
    />
  );
};

export const Route = createFileRoute("/$project/why/$rev/$")({
  component: Page,
  head: ({ params: { _splat, project } }) => ({
    meta: [{ title: pageTitle(`${project}: why ${_splat ?? ""}`) }],
  }),
});
