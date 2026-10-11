import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Predicate } from "effect";

import { hereOf } from "../features/auth/session-slot.tsx";
import { ImportView } from "../features/import/import-page.tsx";
import { useImporter } from "../features/import/use-importer.tsx";
import { pageHead } from "../features/shared/head.ts";
import { personalPage } from "../server/cache-headers.ts";

// `/import`: import a public repo as a project. Who is signed in is read
// in the browser (the server paints the page while it checks); an import
// made goes to the project's page, a refusal shows under the form.
// `?url=<https URL>` fills the form; nothing is imported until Import is
// pressed. A page about its reader, kept by no cache.

/** A page about its reader, kept by no cache. */
export const importHeaders = () => personalPage;

const ImportPage = () => {
  const { url } = Route.useSearch();
  const here = useLocation({ select: hereOf });
  const importer = useImporter();

  return <ImportView {...importer} here={here} url={url} />;
};

/** The address's search: the URL to fill the form with, when it is text. */
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
