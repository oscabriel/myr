/**
 * What the shell lends the parts inside it: a way to open its overlays (the
 * rail as a sheet, the phone's More and Projects sheets, the keys dialog),
 * the project the address is in, and what the root route read for the rail
 * (the list of projects, the count on Today). The shell's parts are views:
 * the root route wires the reads (`src/routes/__root.tsx`).
 */
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { useMatch } from "@tanstack/react-router";
import { Schema } from "effect";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** One of the shell's overlays. */
export type Overlay = "keys" | "menu" | "more" | "projects";

export interface Shell {
  readonly open: (overlay: Overlay) => void;
}

export const ShellContext = createContext<Shell>({
  open: () => {
    // Outside the shell (a view's own test) there is nothing to open.
  },
});

/** The shell's overlays, from inside it. */
export const useShell = (): Shell => useContext(ShellContext);

const isProjectName = Schema.is(ProjectName);

/**
 * The project the address is in: the `$project` route's name, when it is
 * one a project could have. None on the site's own pages, and none for a
 * name no project may take (the page says so itself).
 */
export const useCurrentProject = (): ProjectName | undefined =>
  useMatch({
    from: "/$owner/$project",
    select: ({ params }) =>
      isProjectName(params.project) ? params.project : undefined,
    shouldThrow: false,
  });

/** What the root route read for the rail. */
export interface ShellReads {
  /** Every listed project, once the list has arrived in the browser; nothing before. */
  readonly projects?: readonly ProjectListing[] | undefined;
  /** Today's count, drawn at the end of its row (`RailCount`); nothing for a reader who decides nothing. */
  readonly todayCount?: ReactNode;
}

export const ShellReadsContext = createContext<ShellReads>({});

/**
 * Every listed project, once the list has arrived: the server renders the
 * rail without them (the current project's name comes from the address),
 * and nothing on a page waits on the list.
 */
export const useProjectList = (): readonly ProjectListing[] | undefined =>
  useContext(ShellReadsContext).projects;

/** Today's count for the rail, when there is one. */
export const useTodayCount = (): ReactNode =>
  useContext(ShellReadsContext).todayCount;
