/**
 * The rail's slot: room under the project's line for what a page keeps
 * beside it while the reader moves between its siblings (the code pages'
 * file tree). A route names the component that fills it in its
 * `staticData.rail`; the shell draws the deepest one the address matches,
 * on the server too. Sibling routes that name the same component keep one
 * mounted instance as the reader moves between them, since the rail itself
 * never leaves the page.
 *
 * ```tsx
 * const CodeRail = () => <RailSlot label="Files"><ProjectTree /></RailSlot>;
 *
 * export const Route = createFileRoute("/$owner/$project/blob/$rev/$")({
 *   staticData: { rail: CodeRail },
 * });
 * ```
 */
import { useMatches } from "@tanstack/react-router";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** What fills the rail's slot on this route's pages, and on its children's. */
    readonly rail?: ComponentType;
  }
}

/** The slot's frame: the rest of the rail's height, scrolling on its own. */
export const RailSlot = ({
  children,
  label = "Files",
}: {
  readonly children: ReactNode;
  /** What the slot holds, for a screen reader moving by region. */
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

/** The component the deepest matched route puts in the slot, when one does. */
export const useRailContent = (): ComponentType | undefined =>
  useMatches({
    select: (matches) =>
      matches.findLast(({ staticData }) => staticData.rail !== undefined)
        ?.staticData.rail,
  });

/** The slot's content for the address, or nothing. */
export const RailSlotOutlet = (): ReactNode => {
  const Content = useRailContent();

  return Content === undefined ? null : createElement(Content);
};
