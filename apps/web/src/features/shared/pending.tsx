/**
 * What a page shows while its reads are on their way, when the platform
 * did not answer, and when nothing is at an address, each inside the shell
 * (the rail, the bars and the context bar stay):
 *
 * - `ReadingRows`: rows of a list's own height (64 px), each two hairline
 *   bars, with no shimmer; `Reading` is a page of them under its title;
 * - `Unreachable`: the platform did not answer, said in ink with a way to
 *   ask again. It is not a refusal (a refusal is the platform's answer, and
 *   this is the absence of one), so it is never drawn in the refusal's red;
 * - `PendingPage`, `RouteError` and `NotFoundPage`: the router's own pending,
 *   failure and missing pages (`src/router.tsx`).
 */
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useLocation } from "@tanstack/react-router";
import { Unplug } from "lucide-react";

import { Button } from "../../components/ui/button.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { PageShell } from "./layout.tsx";
import { AppLink } from "./link.tsx";
import { crumbsFor, projectOf } from "./shell/sections.ts";
import { Workspace } from "./shell/workspace.tsx";

const ROWS = ["first", "second", "third"] as const;

/** Rows that hold a list's place while the platform answers: a row's height, two bars each. */
export const ReadingRows = () => (
  <div aria-busy="true" className="flex flex-col">
    <output className="sr-only">Reading from the platform</output>
    {ROWS.map((row) => (
      <div
        className="border-rule flex h-16 flex-col justify-center gap-2.5 border-t"
        key={row}
      >
        <Skeleton className="h-3 w-full max-w-[28rem]" />
        <Skeleton className="h-2.5 w-full max-w-[14rem]" />
      </div>
    ))}
  </div>
);

export const Reading = ({ title }: { readonly title: string }) => (
  <PageShell title={title}>
    <ReadingRows />
  </PageShell>
);

const reload = () => {
  globalThis.location.reload();
};

/** The platform did not answer: in ink, with a way to ask again. */
export const UnreachableNotice = () => (
  <div
    className="border-rule-strong flex max-w-[40rem] items-start gap-3 border p-4"
    role="alert"
  >
    <Unplug
      aria-hidden="true"
      className="text-muted-foreground mt-0.5 size-5 shrink-0"
      strokeWidth={1.75}
    />
    <div className="flex flex-col items-start gap-1.5">
      <p className="font-semibold">The platform did not answer.</p>
      <p className="text-ui text-muted-foreground">
        Try again in a minute; nothing was changed. Git and the CLI reach it
        directly.
      </p>
      <Button className="mt-2" onClick={reload} size="sm" variant="outline">
        Reload
      </Button>
    </div>
  </div>
);

export const Unreachable = ({ title }: { readonly title: string }) => (
  <PageShell title={title}>
    <UnreachableNotice />
  </PageShell>
);

/** The page's name as its address gives it: the last step of its trail. */
const useAddressTitle = () =>
  useLocation({
    select: ({ pathname }) => crumbsFor(pathname).at(-1)?.label ?? "",
  });

/**
 * A page the router is still loading, after 300 ms: its name from the
 * address over rows that hold its place, so a quick move never flashes and
 * a slow one keeps the shell where it is.
 */
export const PendingPage = () => (
  <PageShell title={useAddressTitle()}>
    <ReadingRows />
  </PageShell>
);

/**
 * A page whose read failed on its way (the platform did not answer, or
 * answered with nothing the page could read), inside the shell.
 */
export const RouteError = (_props: ErrorComponentProps) => (
  <PageShell title={useAddressTitle()}>
    <UnreachableNotice />
  </PageShell>
);

/** An address no page serves: the trail up to what exists, and the ways onward. */
export const NotFoundPage = () => {
  const pathname = useLocation({ select: (location) => location.pathname });
  const project = projectOf(pathname);

  return (
    <Workspace
      crumbs={[
        ...(project === undefined
          ? []
          : [{ label: project, to: `/${project}` }]),
        { label: "No such page" },
      ]}
      title="No such page"
    >
      <p className="text-want">
        Nothing is at{" "}
        <code className="text-mono font-mono [overflow-wrap:anywhere]">
          {pathname}
        </code>
        .
      </p>
      <ul className="text-ui flex flex-wrap gap-x-6 gap-y-2">
        <li>
          <AppLink
            className="decoration-rule hover:decoration-foreground underline"
            to="/"
          >
            Open asks
          </AppLink>
        </li>
        {project === undefined ? null : (
          <li>
            <AppLink
              className="decoration-rule hover:decoration-foreground underline"
              to={`/${project}`}
            >
              {project}
            </AppLink>
          </li>
        )}
      </ul>
    </Workspace>
  );
};
