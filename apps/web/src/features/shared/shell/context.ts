import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { useMatch } from "@tanstack/react-router";
import { Schema } from "effect";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type Overlay = "keys" | "menu" | "more" | "projects";

export interface Shell {
  readonly open: (overlay: Overlay) => void;
}

export const ShellContext = createContext<Shell>({
  open: () => {
    // Outside the shell (a view's own test) there is nothing to open.
  },
});

export const useShell = (): Shell => useContext(ShellContext);

const isProjectName = Schema.is(ProjectName);

export const useCurrentProject = (): ProjectName | undefined =>
  useMatch({
    from: "/$owner/$project",
    select: ({ params }) =>
      isProjectName(params.project) ? params.project : undefined,
    shouldThrow: false,
  });

export interface ShellReads {
  readonly projects?: readonly ProjectListing[] | undefined;
  readonly todayCount?: ReactNode;
}

export const ShellReadsContext = createContext<ShellReads>({});

export const useProjectList = (): readonly ProjectListing[] | undefined =>
  useContext(ShellReadsContext).projects;

export const useTodayCount = (): ReactNode =>
  useContext(ShellReadsContext).todayCount;
