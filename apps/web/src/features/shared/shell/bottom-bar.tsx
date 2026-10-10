/**
 * The phone's bottom bar, fixed above the home indicator: Asks, Today,
 * Projects (the switcher, as a sheet) and More (For agents, the project's
 * sections, the keys and the session), each a mark over its word. The
 * current page's item is ink at 600 with a rule on its top edge; the rest
 * are muted.
 */
import { CalendarCheck, Ellipsis, Folders, List } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppLink } from "../link.tsx";
import { useShell } from "./context.ts";
import type { Overlay } from "./context.ts";

const ITEM =
  "text-label text-muted-foreground hover:text-foreground before:bg-foreground relative flex h-14 cursor-pointer flex-col items-center justify-center gap-1 no-underline transition-colors duration-[120ms] before:absolute before:inset-x-4 before:-top-px before:h-0.5 before:opacity-0 focus-visible:outline-offset-[-2px] aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:before:opacity-100";

const MARK = "size-5";

const LINKS = [
  { icon: List, label: "Asks", to: "/" },
  { icon: CalendarCheck, label: "Today", to: "/today" },
] as const satisfies readonly {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly to: string;
}[];

const SHEETS = [
  { icon: Folders, label: "Projects", overlay: "projects" },
  { icon: Ellipsis, label: "More", overlay: "more" },
] as const satisfies readonly {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly overlay: Overlay;
}[];

export const BottomBar = () => {
  const { open } = useShell();

  return (
    <nav
      aria-label="Sections"
      className="border-rule bg-background tablet:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)]"
    >
      {LINKS.map(({ icon: Icon, label, to }) => (
        <AppLink
          activeOptions={{ exact: true, includeSearch: false }}
          className={ITEM}
          key={to}
          to={to}
        >
          <Icon aria-hidden="true" className={MARK} strokeWidth={1.75} />
          {label}
        </AppLink>
      ))}
      {SHEETS.map(({ icon: Icon, label, overlay }) => (
        <button
          aria-haspopup="dialog"
          className={ITEM}
          key={overlay}
          onClick={() => {
            open(overlay);
          }}
          type="button"
        >
          <Icon aria-hidden="true" className={MARK} strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </nav>
  );
};
