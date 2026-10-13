import { Brand } from "@repo/brand";
import { createFileRoute } from "@tanstack/react-router";

import { PrivacyView } from "../features/legal/legal-pages.tsx";
import { pageHead } from "../features/shared/head.ts";
import { branchPage } from "../server/cache-headers.ts";

export const Route = createFileRoute("/privacy")({
  staticData: { shell: "site" },
  component: PrivacyView,
  headers: () => branchPage,
  head: () =>
    pageHead({
      description: `What ${Brand.name} collects, how it uses it, and how to have your account data deleted.`,
      title: "Privacy policy",
    }),
});
