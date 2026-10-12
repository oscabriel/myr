import { useHydrated, useLocation, useRouter } from "@tanstack/react-router";
import { Predicate } from "effect";
import { ChevronDown, PanelRight } from "lucide-react";
import { Suspense, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button.tsx";
import { InspectorCommands } from "../command.tsx";
import { CommandSlotProvider } from "../keys.tsx";
import { ContextBar } from "./context-bar.tsx";
import { LazyFactsSheet } from "./lazy-overlays.ts";
import { crumbsFor } from "./sections.ts";
import type { Crumb } from "./sections.ts";

export interface WorkspaceProps {
  readonly crumbs?: readonly Crumb[];
  readonly title: ReactNode;
  readonly said?: boolean | undefined;
  readonly status?: ReactNode;
  readonly meta?: ReactNode;
  readonly state?: ReactNode;
  readonly count?: string;
  readonly primaryCommand?: string;
  readonly toolbar?: ReactNode;
  readonly facts?: ReactNode;
  readonly factsHeading?: string;
  readonly factsSummary?: ReactNode;
  readonly factsKey?: string;
  readonly variant?: "code" | "document" | "list";
  readonly children: ReactNode;
}

export const GUTTER = "px-4 tablet:px-5 shell:px-6";

export const MEASURE = "max-w-[56rem]";

const LONG_TITLE = 80;

const PageHead = ({
  meta,
  said = false,
  status,
  title,
}: Pick<WorkspaceProps, "meta" | "said" | "status" | "title">) => (
  <div className="flex flex-col gap-4 pt-6 pb-6">
    <h1
      data-said={said ? "" : undefined}
      className={`text-balance break-words ${
        Predicate.isString(title) && title.length > LONG_TITLE
          ? "text-title"
          : "text-headline"
      }`}
    >
      {title}
    </h1>
    {status === undefined ? null : <div>{status}</div>}
    {meta === undefined ? null : (
      <div className="text-ui text-muted-foreground">{meta}</div>
    )}
  </div>
);

const FactsHeading = ({ heading }: { readonly heading: string }) => (
  <div
    aria-live="polite"
    className="border-rule bg-background sticky top-0 z-10 flex h-11 shrink-0 items-center border-b px-4"
  >
    <h2 className="text-ui font-semibold">{heading}</h2>
  </div>
);

const Settling = ({
  children,
  id,
}: {
  readonly children: ReactNode;
  readonly id: string | undefined;
}) => (
  <div className="animate-in fade-in-0 flex flex-col duration-[120ms]" key={id}>
    {children}
  </div>
);

const InlineFacts = ({
  facts,
  heading,
  list,
  summary,
}: {
  readonly facts: ReactNode;
  readonly heading: string;
  readonly list: boolean;
  readonly summary: ReactNode;
}) =>
  list ? (
    <details
      className={`group border-rule shell:hidden mb-6 border-y ${MEASURE}`}
      data-facts="inline"
    >
      <summary className="text-ui hover:bg-surface flex min-h-11 cursor-pointer list-none items-center gap-3 py-2 transition-colors duration-[120ms] [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{heading}</span>
        {summary === undefined ? null : (
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            {summary}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground ml-auto size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
          strokeWidth={1.75}
        />
      </summary>
      <div className="flex flex-col pb-4">{facts}</div>
    </details>
  ) : (
    <section
      aria-label={heading}
      className={`border-rule shell:hidden mb-6 border-y py-4 ${MEASURE}`}
      data-facts="inline"
    >
      <h2 className="text-ui mb-2 font-semibold">{heading}</h2>
      <div className="flex flex-col">{facts}</div>
    </section>
  );

const FactsSheet = ({
  facts,
  heading,
}: {
  readonly facts: ReactNode;
  readonly heading: string;
}) => {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();

  return (
    <>
      <Button
        aria-haspopup="dialog"
        className="codefacts:hidden"
        onClick={() => {
          setOpen(true);
        }}
        size="sm"
        variant="outline"
      >
        <PanelRight aria-hidden="true" strokeWidth={1.75} />
        Facts
      </Button>
      {hydrated && LazyFactsSheet !== undefined ? (
        <Suspense fallback={null}>
          <LazyFactsSheet
            content={facts}
            heading={heading}
            onOpenChange={setOpen}
            open={open}
          />
        </Suspense>
      ) : null}
    </>
  );
};

const WorkspaceView = ({
  children,
  count,
  crumbs,
  facts,
  factsHeading = "Facts",
  factsKey,
  factsSummary,
  meta,
  primaryCommand,
  said,
  state,
  status,
  title,
  toolbar,
  pathname,
  variant = "document",
}: WorkspaceProps & {
  readonly pathname: string;
}) => {
  const hasFacts = facts !== undefined && facts !== null;
  const code = variant === "code";

  return (
    <>
      <main
        className="shell:h-dvh shell:overflow-y-auto flex min-w-0 flex-1 flex-col outline-none"
        data-scroll-restoration-id="main"
        data-variant={variant}
        id="main"
        tabIndex={-1}
      >
        <CommandSlotProvider slot="main">
          <ContextBar
            count={count}
            crumbs={crumbs ?? crumbsFor(pathname)}
            end={
              code && hasFacts ? (
                <FactsSheet
                  facts={facts}
                  heading={factsHeading}
                  key={pathname}
                />
              ) : undefined
            }
            primaryCommand={primaryCommand}
            state={state}
          />
          <div className={`${GUTTER} ${code ? "" : MEASURE}`}>
            <PageHead meta={meta} said={said} status={status} title={title} />
          </div>
          {hasFacts && !code ? (
            <CommandSlotProvider slot="facts">
              <div className={GUTTER}>
                <InlineFacts
                  facts={facts}
                  heading={factsHeading}
                  list={variant === "list"}
                  summary={factsSummary}
                />
              </div>
            </CommandSlotProvider>
          ) : null}
          {toolbar === undefined ? null : (
            <div
              className={`border-rule bg-background tablet:top-[2.9375rem] shell:top-[2.6875rem] sticky top-[2.6875rem] z-10 h-10 shrink-0 border-y ${GUTTER}`}
              data-toolbar=""
            >
              {/* Its controls end where the rows end; its rules run the pane. */}
              <div
                className={`flex h-full items-center gap-3 ${code ? "" : MEASURE}`}
              >
                {toolbar}
              </div>
            </div>
          )}
          <div
            className={`flex flex-1 flex-col gap-8 pb-16 ${
              code ? "" : `${GUTTER} ${MEASURE}`
            } ${toolbar === undefined ? "" : "pt-6"}`}
          >
            {children}
          </div>
        </CommandSlotProvider>
      </main>
      {hasFacts ? (
        <aside
          aria-label="Facts"
          className={`border-rule bg-background codefacts:w-[22rem] h-dvh w-[20rem] shrink-0 flex-col overflow-y-auto overscroll-contain border-l ${
            code ? "codefacts:flex hidden" : "shell:flex hidden"
          }`}
          data-facts="inspector"
          id="facts"
        >
          <CommandSlotProvider slot="facts">
            <FactsHeading heading={factsHeading} />
            <div className="flex flex-col px-4 py-4">
              <InspectorCommands>
                <Settling id={factsKey}>{facts}</Settling>
              </InspectorCommands>
            </div>
          </CommandSlotProvider>
        </aside>
      ) : null}
    </>
  );
};

const AtAddress = (props: WorkspaceProps) => (
  <WorkspaceView
    {...props}
    pathname={useLocation({ select: (location) => location.pathname })}
  />
);

export const Workspace = (props: WorkspaceProps) =>
  Predicate.isNotNullish(useRouter({ warn: false })) ? (
    <AtAddress {...props} />
  ) : (
    <WorkspaceView {...props} pathname="" />
  );
