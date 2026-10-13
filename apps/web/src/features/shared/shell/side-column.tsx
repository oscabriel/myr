import { useMatches } from "@tanstack/react-router";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** A project page's side column: the file tree beside code, or a finish's files. */
    readonly column?: ComponentType;
  }
}

/** Its own scroll, so a long tree never moves the page beside it. */
export const SideColumn = ({
  children,
  label = "Files",
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) => (
  <section
    aria-label={label}
    className="flex min-h-0 flex-1 flex-col overflow-hidden"
    data-column="tree"
  >
    {children}
  </section>
);

export const useSideColumn = (): ComponentType | undefined =>
  useMatches({
    select: (matches) =>
      matches.findLast(({ staticData }) => staticData.column !== undefined)
        ?.staticData.column,
  });

export const SideColumnOutlet = (): ReactNode => {
  const Content = useSideColumn();

  return Content === undefined ? null : createElement(Content);
};
