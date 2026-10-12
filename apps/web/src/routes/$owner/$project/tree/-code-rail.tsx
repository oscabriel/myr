// A route's `staticData` loads with every page, so this module stays light: the browser loads the rail's body
// (`-rail-body.tsx`) once the page is up.
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { RailSlot } from "../../../../features/shared/shell/rail-slot.tsx";

const Body = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./-rail-body.tsx"));

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

export const CodeRail = () => (
  <RailSlot label="Files">
    <Later commit={false} />
  </RailSlot>
);

export const CommitRail = () => (
  <RailSlot label="Changed files">
    <Later commit />
  </RailSlot>
);
