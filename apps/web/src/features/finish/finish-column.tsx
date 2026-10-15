/**
 * A route's `staticData` loads with every page, so this module stays light and
 * loads a finish's files in the browser.
 */
import { ClientOnly, useMatch } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import { lazy, Suspense } from "react";

import { AppLink } from "../shared/link.tsx";
import { INBOX_PATH } from "../shared/paths.ts";
import { SideColumn } from "../shared/shell/side-column.tsx";

const FinishPageData = Schema.Struct({
  read: Schema.TaggedStruct("Found", {
    decision: Schema.Struct({
      subject: Schema.TaggedStruct("Finish", {}),
    }),
  }),
});

const isFinishPage = Schema.decodeUnknownOption(FinishPageData);

const ROW =
  "text-ui text-foreground hover:bg-surface mx-2 flex h-8 min-w-0 items-center px-2 no-underline transition-colors duration-[120ms] focus-visible:outline-offset-[-2px]";

const Body = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./finish-column-body.tsx"));

const Placeholder = () => (
  <div aria-hidden="true" className="border-rule h-10 shrink-0 border-b" />
);

export const FinishColumn = () => {
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
      <SideColumn label="Decisions">
        <div className="flex flex-col py-2">
          <AppLink className={ROW} to={INBOX_PATH}>
            Inbox
          </AppLink>
          {project === undefined ? null : (
            <AppLink className={ROW} to={`/${project}/policy`}>
              Who decides in {project}
            </AppLink>
          )}
        </div>
      </SideColumn>
    ),
    onSome: () => (
      <SideColumn label="Changed files">
        {Body === undefined ? (
          <Placeholder />
        ) : (
          <ClientOnly fallback={<Placeholder />}>
            <Suspense fallback={<Placeholder />}>
              <Body />
            </Suspense>
          </ClientOnly>
        )}
      </SideColumn>
    ),
  });
};
