// A route's `staticData` loads with every page, so this module stays light: the browser loads the column's body
// (`-code-files.tsx`) once the page is up.
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { SideColumn } from "../../../../features/shared/shell/side-column.tsx";

const Body = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./-code-files.tsx"));

const Later = ({ commit }: { readonly commit: boolean }) =>
  Body === undefined ? null : (
    <ClientOnly fallback={null}>
      <Suspense fallback={null}>
        <Body commit={commit} />
      </Suspense>
    </ClientOnly>
  );

/** The repository's tree beside a page of Files or Commits. */
export const CodeColumn = () => (
  <SideColumn label="Files">
    <Later commit={false} />
  </SideColumn>
);

/** A commit's changed files beside its diff. */
export const CommitColumn = () => (
  <SideColumn label="Changed files">
    <Later commit />
  </SideColumn>
);
