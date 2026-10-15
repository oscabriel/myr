import { createFileRoute } from "@tanstack/react-router";

import { movedToPolicy } from "../../../features/project-people/moved.ts";

export const Route = createFileRoute("/$owner/$project/people")({
  beforeLoad: movedToPolicy,
});
