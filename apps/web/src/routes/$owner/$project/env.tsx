import { createFileRoute } from "@tanstack/react-router";

import { movedToEnvironment } from "../../../features/visibility/moved.ts";

export const Route = createFileRoute("/$owner/$project/env")({
  beforeLoad: movedToEnvironment,
});
