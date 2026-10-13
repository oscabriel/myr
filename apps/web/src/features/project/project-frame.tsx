/**
 * Every page of a project inside one frame: the project's header across the
 * top, then a page's side column (the file tree beside code, a finish's
 * files) and the page itself.
 */
import type { ReactNode } from "react";

import {
  SideColumnOutlet,
  useSideColumn,
} from "../shared/shell/side-column.tsx";

/**
 * The tabs stick under the top bar, so what sticks inside the frame sits
 * under both: `--stick-bar` and `--stick-toolbar` move down by the tabs.
 */
const UNDER_TABS =
  "[--stick-bar:calc(var(--top-bar)_+_var(--tabs)_-_1px)] [--stick-toolbar:calc(var(--top-bar)_+_var(--tabs)_+_var(--toolbar)_-_1px)] [--stick-column:calc(var(--top-bar)_+_var(--tabs))]";

const UNDER_BAR = "[--stick-column:var(--top-bar)]";

/**
 * From `columns` the side column stands beside the page. Below it the column
 * is hidden rather than stacked: the Files button's sheet is the file tree's
 * narrow form until issue 04 decides the Code tab.
 */
export const ProjectFrame = ({
  children,
  header,
}: {
  readonly header?: ReactNode;
  readonly children: ReactNode;
}) => {
  const column = useSideColumn() !== undefined;

  return (
    <div
      className={`flex w-full min-w-0 flex-1 flex-col ${header === undefined ? UNDER_BAR : UNDER_TABS}`}
      data-project-frame=""
    >
      {header}
      <div className="flex w-full min-w-0 flex-1">
        {column ? (
          <div className="border-rule columns:flex sticky top-(--stick-column) hidden h-[calc(100dvh-var(--stick-column))] w-(--column-tree) shrink-0 flex-col border-r">
            <SideColumnOutlet />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
};
