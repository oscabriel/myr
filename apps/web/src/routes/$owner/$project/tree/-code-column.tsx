// A route's `staticData` loads with every page, so this module stays light: the browser loads the column's body
// (`-column-body.tsx`) once the page is up.
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { SideColumn } from "../../../../features/shared/shell/side-column.tsx";

const Body = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./-column-body.tsx"));

const Placeholder = () => (
  <div aria-hidden="true" className="border-rule h-12 shrink-0 border-b" />
);

const Later = ({ commit }: { readonly commit: boolean }) =>
  Body === undefined ? (
    <Placeholder />
  ) : (
    <ClientOnly fallback={<Placeholder />}>
      <Suspense fallback={<Placeholder />}>
        <Body commit={commit} />
      </Suspense>
    </ClientOnly>
  );

export const CodeColumn = () => (
  <SideColumn label="Files">
    <Later commit={false} />
  </SideColumn>
);

export const CommitColumn = () => (
  <SideColumn label="Changed files">
    <Later commit />
  </SideColumn>
);
