import { createFileRoute } from "@tanstack/react-router";

import { movedToInbox } from "../features/inbox/moved.ts";

export const Route = createFileRoute("/home")({ beforeLoad: movedToInbox });
