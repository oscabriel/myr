import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Predicate } from "effect";

import { hereOf } from "../features/auth/session-slot.tsx";
import { ImportView } from "../features/import/import-page.tsx";
import { useImporter } from "../features/import/use-importer.tsx";
import { pageHead } from "../features/shared/head.ts";
import { personalPage } from "../server/cache-headers.ts";

export const importHeaders = () => personalPage;

const ImportPage = () => {
  const { url } = Route.useSearch();
  const here = useLocation({ select: hereOf });
  const importer = useImporter();

  return <ImportView {...importer} here={here} url={url} />;
};

export const importSearch = ({
  url,
}: {
  readonly url?: unknown;
}): { readonly url?: string } => (Predicate.isString(url) ? { url } : {});

export const Route = createFileRoute("/import")({
  validateSearch: importSearch,
  headers: importHeaders,
  head: () => pageHead({ title: "Import a repo" }),
  component: ImportPage,
});
