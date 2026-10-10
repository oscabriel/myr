/**
 * A project's section row: Asks, Code, Landings, Refs, Policy, Ledger and
 * Env shape, one line under the page's head where the rail is not drawn
 * (below 1120 px; from there the rail lists them). The line scrolls
 * sideways inside itself and never wraps, so it never pushes the page
 * sideways. The page being read is marked `aria-current` and underlined in
 * ink; a page under none of them (a proposal) marks none.
 *
 * Its links are the router's (`AppLink`), so moving between sections never
 * reloads the page.
 */
import type { ProjectName } from "@repo/protocol/ids";
import type { ReactNode } from "react";

import { AppLink } from "../shared/link.tsx";
import { projectSections } from "../shared/shell/sections.ts";
import type { ProjectTab } from "../shared/shell/sections.ts";

export type { ProjectTab } from "../shared/shell/sections.ts";

export const ProjectNav = ({
  current,
  project,
}: {
  readonly current?: ProjectTab | undefined;
  readonly project: ProjectName;
}): ReactNode => (
  <nav
    aria-label={project}
    className="border-rule shell:hidden -mt-2 flex [scrollbar-width:none] overflow-x-auto overscroll-x-contain border-b"
  >
    {projectSections(project).map(({ label, tab, to }) => (
      <AppLink
        activeOptions={{ exact: true, includeSearch: false }}
        aria-current={tab === current ? "page" : undefined}
        className="text-ui text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground -mb-px flex h-10 shrink-0 items-center border-b-2 border-transparent px-3 whitespace-nowrap no-underline transition-colors duration-[120ms] first:pl-0 focus-visible:outline-offset-[-2px] aria-[current=page]:font-semibold"
        key={tab}
        to={to}
      >
        {label}
      </AppLink>
    ))}
  </nav>
);
