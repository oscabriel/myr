/**
 * One page's panes: main (the context bar, the page's head, its toolbar and
 * its content) and, when the page has typed facts, the inspector, both
 * rendered in one pass on the server. Every page renders one `Workspace`.
 *
 * From the shell's width main scrolls on its own and the inspector is a
 * column of its own scroll on the right, its heading announcing what it
 * describes as it changes. Below it, the facts sit in one slot after the
 * page's head: open on a subject's page, a disclosure on a list's (whose
 * summary keeps one fact in sight). Code pages keep the width for the code:
 * the inspector is a column from 1440 px and a sheet below, behind a Facts
 * button in the context bar.
 *
 * Rows and the head stop at 56 rem, left-aligned; prose at 70 ch is the
 * page's; code takes the whole pane.
 */
import { useHydrated, useLocation, useRouter } from "@tanstack/react-router";
import { Predicate } from "effect";
import { ChevronDown, PanelRight } from "lucide-react";
import { Suspense, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button.tsx";
import { CommandSlotProvider } from "../keys.tsx";
import { ContextBar } from "./context-bar.tsx";
import { LazyFactsSheet } from "./lazy-overlays.ts";
import { crumbsFor } from "./sections.ts";
import type { Crumb } from "./sections.ts";

export interface WorkspaceProps {
  /** The trail to the page; the address's when left out. */
  readonly crumbs?: readonly Crumb[];
  /** The page head's title: the headline, or a title when it runs long. */
  readonly title: ReactNode;
  /** The title is someone's own words (a want), shown as they wrote it. */
  readonly said?: boolean | undefined;
  /** A status line under the title. */
  readonly status?: ReactNode;
  /** A 14 px muted line under the status: kind, asker, age. */
  readonly meta?: ReactNode;
  /** The subject's state in a word and a mark, at the context bar's end. */
  readonly state?: ReactNode;
  /** A list's count, at the context bar's end ("10 open asks, 8 open to take"). */
  readonly count?: string;
  /** The page's one command, copied from the context bar. */
  readonly primaryCommand?: string;
  /** Filters, view toggles, sort: a bar that stays under the context bar. */
  readonly toolbar?: ReactNode;
  /** The inspector's fact blocks; inline below the shell's width. */
  readonly facts?: ReactNode;
  /** What the facts describe: "This ask", "Selected ask", "How a change lands here". */
  readonly factsHeading?: string;
  /** The one fact a list keeps in sight below the shell's width (its posture). */
  readonly factsSummary?: ReactNode;
  /** The facts' subject (a selected row's id): a new one settles in. */
  readonly factsKey?: string;
  /** A document (the default), a list, or code. */
  readonly variant?: "code" | "document" | "list";
  /** Main's content. */
  readonly children: ReactNode;
}

/** Main's side padding at each width. */
export const GUTTER = "px-4 tablet:px-5 shell:px-6";

/** How wide rows and the head run: 56 rem, from the left. */
export const MEASURE = "max-w-[56rem]";

/** Past this many characters a title is set a step down, to stay within three lines. */
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

/** The inspector's heading row: names what the facts describe, and announces it when it changes. */
const FactsHeading = ({ heading }: { readonly heading: string }) => (
  <div
    aria-live="polite"
    className="border-rule bg-background sticky top-0 z-10 flex h-11 shrink-0 items-center border-b px-4"
  >
    <h2 className="text-ui font-semibold">{heading}</h2>
  </div>
);

/** The facts settling in when their subject changes: 120 ms of opacity, nothing that moves. */
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

/** The facts in main, after the head, below the shell's width. */
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

/** A code page's Facts button, and its facts as a sheet from the right. */
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
  /** The address, for the default trail; none outside a router. */
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
                // The sheet belongs to the page it opened on.
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
          className={`border-rule bg-background h-dvh w-[20rem] codefacts:w-[22rem] shrink-0 flex-col overflow-y-auto overscroll-contain border-l ${
            code ? "codefacts:flex hidden" : "shell:flex hidden"
          }`}
          data-facts="inspector"
          id="facts"
        >
          <CommandSlotProvider slot="facts">
            <FactsHeading heading={factsHeading} />
            <div className="flex flex-col px-4 py-4">
              <Settling id={factsKey}>{facts}</Settling>
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

/**
 * A page's panes. Inside the router its trail defaults to its address's; a
 * view rendered alone (its own test) draws the same panes with the trail
 * it is given.
 */
export const Workspace = (props: WorkspaceProps) =>
  Predicate.isNotNullish(useRouter({ warn: false })) ? (
    <AtAddress {...props} />
  ) : (
    <WorkspaceView {...props} pathname="" />
  );
