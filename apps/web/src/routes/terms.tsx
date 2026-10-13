import { Brand } from "@repo/brand";
import { createFileRoute } from "@tanstack/react-router";

import { TermsView } from "../features/legal/legal-pages.tsx";
import { pageHead } from "../features/shared/head.ts";
import { branchPage } from "../server/cache-headers.ts";

export const Route = createFileRoute("/terms")({
  staticData: { shell: "site" },
  component: TermsView,
  headers: () => branchPage,
  head: () =>
    pageHead({
      description: `The terms that govern use of ${Brand.name}.`,
      title: "Terms of service",
    }),
});
