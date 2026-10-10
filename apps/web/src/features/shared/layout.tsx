/**
 * What every page renders inside the shell (`shell/app-shell.tsx`):
 * `PageShell`, a page with a title and no facts, drawn by the shell's
 * `Workspace` (its context bar names the page from its address), for the
 * pages that have not yet come to `Workspace` themselves; and the skip link
 * the shell puts first, so a keyboard passes the rail to the page.
 */
import type { ReactNode } from "react";

import { Workspace } from "./shell/workspace.tsx";

export const PageShell = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => <Workspace title={title}>{children}</Workspace>;

/** The first stop of a keyboard on every page: straight to main, past the rail. */
export const SkipLink = () => (
  <a
    className="bg-background text-ui sr-only z-50 px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    href="#main"
  >
    Skip to content
  </a>
);
