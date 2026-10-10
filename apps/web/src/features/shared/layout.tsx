/**
 * The shell every page shares: the site header (front page, Today, Agents,
 * the session), one main region per page headed by its title over a double
 * rule, and the footer's ways in (plain git, the CLI, and the Agents page).
 * The root route composes them (`src/routes/__root.tsx`); a page renders
 * `PageShell`.
 */
import { Brand } from "@repo/brand";
import type { ReactNode } from "react";

import { CommandLine } from "./command.tsx";

/** The content column every region lines up on. */
const COLUMN = "mx-auto w-full max-w-6xl px-4 sm:px-6";

/** A page's `<title>`: the page, then the product. */
export const pageTitle = (title: string) => `${title} · ${Brand.name}`;

export const PageShell = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <main className={`${COLUMN} flex-1 pt-6 pb-16 sm:pt-8`} id="main">
    <h1 className="border-rule-strong border-b-[3px] border-double pb-2 text-2xl font-semibold tracking-[-0.02em] text-balance">
      {title}
    </h1>
    <div className="mt-6 flex flex-col gap-8">{children}</div>
  </main>
);

const NAV = [
  { href: "/", label: "Asks" },
  { href: "/today", label: "Today" },
  { href: "/agents", label: "Agents" },
] as const;

/** Whether `href` is the page at `pathname`, or the section it heads. */
const isCurrent = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export const SiteHeader = ({
  pathname,
  session,
}: {
  readonly pathname: string;
  readonly session: ReactNode;
}) => (
  <header className="border-rule border-b">
    <a
      className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2"
      href="#main"
    >
      Skip to content
    </a>
    <div className={`${COLUMN} flex h-12 items-center gap-4 sm:gap-6`}>
      <a
        className="text-base font-bold tracking-[-0.02em] no-underline"
        href="/"
      >
        {Brand.name}
      </a>
      <nav aria-label="Main" className="flex h-full items-stretch gap-4">
        {NAV.map(({ href, label }) => (
          <a
            aria-current={isCurrent(href, pathname) ? "page" : undefined}
            className="text-muted-foreground hover:text-foreground aria-[current=page]:border-rule-strong aria-[current=page]:text-foreground flex items-center border-b-2 border-transparent pt-0.5 text-sm no-underline aria-[current=page]:font-medium"
            href={href}
            key={href}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="ml-auto flex min-w-0 items-center text-sm">{session}</div>
    </div>
  </header>
);

export const SiteFooter = ({
  platformUrl,
}: {
  readonly platformUrl: string;
}) => (
  <footer className="border-rule border-t">
    <div className={`${COLUMN} grid gap-6 py-8 sm:grid-cols-3`}>
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-medium">
          Plain git: clone any project
        </h2>
        <CommandLine command={`git clone ${platformUrl}/<project>.git`} />
      </section>
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-medium">
          Install the {Brand.cli} CLI
        </h2>
        <CommandLine command={`curl -fsSL ${platformUrl}/install.sh | sh`} />
      </section>
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-medium">
          Connect an agent
        </h2>
        <p className="text-sm">
          <a href="/agents">MCP, the CLI, llms.txt and skills</a>, with the
          setup for each agent.
        </p>
      </section>
    </div>
  </footer>
);
