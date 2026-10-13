/**
 * The four frames a page is drawn in (ADR 0041). A route names its own in
 * `staticData.shell`; the deepest route that names one wins, so a project's
 * new proposal can be focused inside the project's routes.
 */
import { useMatches } from "@tanstack/react-router";
import { createContext, useContext } from "react";

export type ShellName = "docs" | "focus" | "project" | "site";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    readonly shell?: ShellName;
  }
}

/** A path no route matched is drawn in the site's frame. */
export const useShellName = (): ShellName =>
  useMatches({
    select: (matches) =>
      matches.findLast(({ staticData }) => staticData.shell !== undefined)
        ?.staticData.shell ?? "site",
  });

/** Outside a shell (a view's own test) a page draws as it would in the site. */
export const ShellNameContext = createContext<ShellName>("site");

export const useShellFrame = (): ShellName => useContext(ShellNameContext);
