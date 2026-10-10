/**
 * The code pages' files: in the rail's slot from the shell's width, and in
 * a sheet behind the Files button below it. A folder's, a file's and a why
 * page name the same `CodeRail`, so one tree stays mounted while the
 * reader moves between them; a commit's page names `CommitRail`.
 *
 * A route's `staticData` loads with every page, so this module stays
 * light: the server draws the ref line's place, and the browser loads the
 * tree, the switcher and the keys (`-rail-body.tsx`) once the page is up.
 * Not a route: the `-` prefix keeps the router from reading it as one.
 */
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { RailSlot } from "../../../features/shared/shell/rail-slot.tsx";

const Body = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./-rail-body.tsx"));

/** The ref line's place, the height the switcher will take. */
const Placeholder = () => (
  <div aria-hidden="true" className="border-rule h-12 shrink-0 border-b" />
);

/** The rail's body, once the browser has it. */
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

/** The rail's slot on a folder's, a file's and a why page. */
export const CodeRail = () => (
  <RailSlot label="Files">
    <Later commit={false} />
  </RailSlot>
);

/** The rail's slot on a commit's page. */
export const CommitRail = () => (
  <RailSlot label="Changed files">
    <Later commit />
  </RailSlot>
);
