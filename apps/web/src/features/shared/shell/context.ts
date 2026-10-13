import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { useMatch } from "@tanstack/react-router";
import { Schema } from "effect";
import { createContext, useContext } from "react";
import type { ComponentType, ReactNode } from "react";

export type Overlay = "keys" | "menu" | "projects";

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

/**
 * What the shell shows but never reads itself, so its pieces stay views: the
 * root hands it the inbox's count (read lazily, once a signed-in reader's
 * page is up) and a reader of the project list (mounted only while the
 * search is open).
 */
export interface ShellReads {
  readonly inboxCount?: ReactNode;
  readonly ReadProjects?: ComponentType<{
    readonly children: (
      listed: readonly ProjectListing[] | undefined
    ) => ReactNode;
  }>;
}

export const ShellReadsContext = createContext<ShellReads>({});

export const useShellReads = (): ShellReads => useContext(ShellReadsContext);
