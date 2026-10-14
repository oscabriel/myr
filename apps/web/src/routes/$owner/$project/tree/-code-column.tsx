// A route's `staticData` loads with every page, so this module stays light: the browser loads the column's body
// (`-code-files.tsx`) once the page is up.
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { TreeSkeleton } from "../../../../features/code/tree-skeleton.tsx";
import { SideColumn } from "../../../../features/shared/shell/side-column.tsx";

const Body = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./-code-files.tsx"));

// The server and the first paint draw the tree's shape, so the column never stands empty while its body loads.
const waiting = (
  <div className="flex min-h-0 flex-1 flex-col pt-3">
    <TreeSkeleton />
  </div>
);

const Later = ({ commit }: { readonly commit: boolean }) =>
  Body === undefined ? (
    waiting
  ) : (
    <ClientOnly fallback={waiting}>
      <Suspense fallback={waiting}>
        <Body commit={commit} />
      </Suspense>
    </ClientOnly>
  );

/** The repository's tree beside a page of Files or History. */
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
