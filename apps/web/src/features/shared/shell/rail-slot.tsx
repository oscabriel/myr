import { useMatches } from "@tanstack/react-router";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    readonly rail?: ComponentType;
  }
}

export const RailSlot = ({
  children,
  label = "Files",
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) => (
  <section
    aria-label={label}
    className="border-rule flex min-h-0 flex-1 flex-col overflow-hidden border-t"
    data-rail-slot=""
  >
    {children}
  </section>
);

export const useRailContent = (): ComponentType | undefined =>
  useMatches({
    select: (matches) =>
      matches.findLast(({ staticData }) => staticData.rail !== undefined)
        ?.staticData.rail,
  });

export const RailSlotOutlet = (): ReactNode => {
  const Content = useRailContent();

  return Content === undefined ? null : createElement(Content);
};
