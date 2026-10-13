import { createFileRoute } from "@tanstack/react-router";

import { movedToLedger } from "../../../features/visibility/moved.ts";

export const Route = createFileRoute("/$owner/$project/ledger")({
  beforeLoad: movedToLedger,
});
