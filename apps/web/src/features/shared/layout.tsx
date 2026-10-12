import type { ReactNode } from "react";

import { Workspace } from "./shell/workspace.tsx";

export const PageShell = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => <Workspace title={title}>{children}</Workspace>;

export const SkipLink = () => (
  <a
    className="bg-background text-ui sr-only z-50 px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    href="#main"
  >
    Skip to content
  </a>
);
