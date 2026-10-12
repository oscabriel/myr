import type { ErrorComponentProps } from "@tanstack/react-router";
import { useLocation } from "@tanstack/react-router";
import { Unplug } from "lucide-react";

import { Button } from "../../components/ui/button.tsx";
import { PageShell } from "./layout.tsx";
import { AppLink } from "./link.tsx";
import { ASKS_PATH } from "./paths.ts";
import { crumbsFor, projectOf } from "./shell/sections.ts";
import { Workspace } from "./shell/workspace.tsx";
import { RowSkeleton } from "./skeleton.tsx";

const ROWS = ["first", "second", "third"] as const;

export const ReadingRows = () => (
  <div aria-busy="true" className="flex flex-col">
    <output className="sr-only">Reading from the platform</output>
    {ROWS.map((row) => (
      <RowSkeleton key={row} />
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

/**
 * Not a refusal (it is the absence of the platform's answer), so never in the
 * refused red.
 */
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

const useAddressTitle = () =>
  useLocation({
    select: ({ pathname }) => crumbsFor(pathname).at(-1)?.label ?? "",
  });

export const PendingPage = () => (
  <PageShell title={useAddressTitle()}>
    <ReadingRows />
  </PageShell>
);

export const RouteError = (_props: ErrorComponentProps) => (
  <PageShell title={useAddressTitle()}>
    <UnreachableNotice />
  </PageShell>
);

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
            to={ASKS_PATH}
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
