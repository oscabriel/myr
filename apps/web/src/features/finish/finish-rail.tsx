/**
 * The rail of a decision's page. A route's `staticData` loads with every
 * page, so this module stays light: it tells a finish from any other
 * decision by the shape of the page's data alone, holds the way back to
 * Today and to who decides for any other, and for a finish loads its
 * changed files in the browser
 * (`finish-rail-body.tsx`), with the list's place held until they come.
 */
import { ClientOnly, useMatch } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import { lazy, Suspense } from "react";

import { AppLink } from "../shared/link.tsx";
import { RailSlot } from "../shared/shell/rail-slot.tsx";

/** A finish's page data, by its shape: found, and about a finish. */
const FinishPageData = Schema.Struct({
  read: Schema.TaggedStruct("Found", {
    decision: Schema.Struct({
      subject: Schema.TaggedStruct("Finish", {}),
    }),
  }),
});

const isFinishPage = Schema.decodeUnknownOption(FinishPageData);

/** A row of the slot, as the rail draws its rows. */
const ROW =
  "text-ui text-foreground hover:bg-surface mx-2 flex h-8 min-w-0 items-center px-2 no-underline transition-colors duration-[120ms] focus-visible:outline-offset-[-2px]";

const Body = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./finish-rail-body.tsx"));

/** The list's place: its count line's height, until the list is drawn. */
const Placeholder = () => (
  <div aria-hidden="true" className="border-rule h-10 shrink-0 border-b" />
);

export const FinishRail = () => {
  const data: unknown = useMatch({
    from: "/$owner/$project/decisions/$decision",
    select: (match) => match.loaderData,
    shouldThrow: false,
  });

  const project = useMatch({
    from: "/$owner/$project/decisions/$decision",
    select: (match) => match.params.project,
    shouldThrow: false,
  });

  return Option.match(isFinishPage(data), {
    onNone: () => (
      <RailSlot label="Decisions">
        <div className="flex flex-col py-2">
          <AppLink className={ROW} to="/today">
            Today
          </AppLink>
          {project === undefined ? null : (
            <AppLink className={ROW} to={`/${project}/people`}>
              Who decides in {project}
            </AppLink>
          )}
        </div>
      </RailSlot>
    ),
    onSome: () => (
      <RailSlot label="Changed files">
        {Body === undefined ? (
          <Placeholder />
        ) : (
          <ClientOnly fallback={<Placeholder />}>
            <Suspense fallback={<Placeholder />}>
              <Body />
            </Suspense>
          </ClientOnly>
        )}
      </RailSlot>
    ),
  });
};
