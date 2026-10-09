/**
 * The tabs every project page shares: Overview, Code, Landings, Refs,
 * People, Ledger and Env shape (the glossary's word). The page being read is marked `aria-current`; a
 * page under none of them (a proposal) marks none.
 *
 * Each tab is a plain `<a>` drawn as a ghost button (`buttonVariants`), as
 * every link between the web's pages is a plain link: a page loads whole
 * from its own route, and a view renders without a router around it, as
 * its tests render it. Base UI's `Button` rendered as `<a>` would give each
 * link `role="button"`, which a nav of pages must not have.
 */
import type { ProjectName } from "@repo/protocol/ids";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";

import { envPath } from "../env/path.ts";
import { ledgerPath } from "../ledger/path.ts";

/** Which of a project's pages is being read. */
export type ProjectTab =
  | "code"
  | "env"
  | "landings"
  | "ledger"
  | "overview"
  | "people"
  | "refs";

/** Each tab: its label and its page's address, in the order the nav shows them. */
const tabs = (project: ProjectName) =>
  [
    { href: `/${project}`, label: "Overview", tab: "overview" },
    { href: `/${project}/tree/main`, label: "Code", tab: "code" },
    { href: `/${project}/commits/main`, label: "Landings", tab: "landings" },
    { href: `/${project}/refs`, label: "Refs", tab: "refs" },
    { href: `/${project}/people`, label: "People", tab: "people" },
    { href: ledgerPath(project), label: "Ledger", tab: "ledger" },
    { href: envPath(project), label: "Env shape", tab: "env" },
  ] as const satisfies readonly {
    readonly href: string;
    readonly label: string;
    readonly tab: ProjectTab;
  }[];

export const ProjectNav = ({
  current,
  project,
}: {
  readonly current?: ProjectTab | undefined;
  readonly project: ProjectName;
}): ReactNode => (
  <nav
    aria-label={project}
    className="border-rule -mt-2 flex flex-wrap gap-1 border-b pb-2"
  >
    {tabs(project).map(({ href, label, tab }) => (
      <a
        aria-current={tab === current ? "page" : undefined}
        className={buttonVariants({
          className:
            "text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground no-underline",
          size: "sm",
          variant: "ghost",
        })}
        href={href}
        key={tab}
      >
        {label}
      </a>
    ))}
  </nav>
);
