import { useLocation, useRouter } from "@tanstack/react-router";
import { Predicate } from "effect";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { CommandSlotProvider } from "../keys.tsx";
import { ContextBar } from "./context-bar.tsx";
import { GUTTER } from "./gutter.ts";
import { crumbsFor } from "./sections.ts";
import type { Crumb } from "./sections.ts";
import { useShellFrame } from "./shells.ts";

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
      className={`group border-rule mb-6 border-y ${MEASURE}`}
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
      className={`border-rule mb-6 border-y py-4 ${MEASURE}`}
      data-facts="inline"
    >
      <h2 className="text-ui mb-2 font-semibold">{heading}</h2>
      <div className="flex flex-col">{facts}</div>
    </section>
  );

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
  const focus = useShellFrame() === "focus";

  return (
    <main
      className="flex min-w-0 flex-1 flex-col outline-none"
      data-scroll-restoration-id="main"
      data-variant={variant}
      id="main"
      tabIndex={-1}
    >
      <CommandSlotProvider slot="main">
        {focus ? null : (
          <ContextBar
            count={count}
            crumbs={crumbs ?? crumbsFor(pathname)}
            primaryCommand={primaryCommand}
            state={state}
          />
        )}
        <div className={`${GUTTER} ${code ? "" : MEASURE}`}>
          <PageHead meta={meta} said={said} status={status} title={title} />
        </div>
        {hasFacts ? (
          <CommandSlotProvider slot="facts">
            {/* A new selection's facts settle in rather than swap. */}
            <div
              className="animate-in fade-in-0 duration-[120ms]"
              key={factsKey}
            >
              <div className={GUTTER}>
                <InlineFacts
                  facts={facts}
                  heading={factsHeading}
                  list={variant !== "document"}
                  summary={factsSummary}
                />
              </div>
            </div>
          </CommandSlotProvider>
        ) : null}
        {toolbar === undefined ? null : (
          <div
            className={`border-rule bg-background sticky top-(--stick-bar) z-10 h-(--toolbar) shrink-0 border-y ${GUTTER}`}
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
