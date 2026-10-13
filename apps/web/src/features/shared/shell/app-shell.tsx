import { useHydrated, useLocation } from "@tanstack/react-router";
import { Suspense, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { KeysProvider } from "../keys.tsx";
import { SkipLink } from "../layout.tsx";
import { ShellContext, ShellReadsContext } from "./context.ts";
import type { Overlay, ShellReads } from "./context.ts";
import { DocsNav } from "./docs-nav.tsx";
import { Footer } from "./footer.tsx";
import { GUTTER } from "./gutter.ts";
import { LazyOverlays } from "./lazy-overlays.ts";
import { ShellNameContext, useShellName } from "./shells.ts";
import type { ShellName } from "./shells.ts";
import { SideColumnOutlet, useSideColumn } from "./side-column.tsx";
import { TopBar } from "./top-bar.tsx";

/** A project page's side column, beside its main column from `columns` and gone below it. */
const ProjectFrame = ({ children }: { readonly children: ReactNode }) => {
  const column = useSideColumn() !== undefined;

  return (
    <div className="max-w-project mx-auto flex w-full flex-1">
      {column ? (
        <div className="border-rule columns:flex sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-(--column-tree) shrink-0 flex-col border-r">
          <SideColumnOutlet />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
};

/** The article first, so it is read first; from `columns` the tree stands to its left. */
const DocsFrame = ({ children }: { readonly children: ReactNode }) => (
  <div className="columns:grid columns:grid-cols-[var(--column-docs-nav)_minmax(0,1fr)] max-w-site mx-auto flex w-full flex-1 flex-col">
    <div className="columns:col-start-2 columns:row-start-1 flex min-w-0 flex-col">
      {children}
    </div>
    <div
      className={`border-rule columns:col-start-1 columns:row-start-1 columns:sticky columns:top-14 columns:self-start columns:max-h-[calc(100dvh-3.5rem)] columns:overflow-y-auto columns:border-t-0 border-t py-6 ${GUTTER}`}
    >
      <DocsNav />
    </div>
  </div>
);

const FRAMES = {
  docs: DocsFrame,
  focus: ({ children }: { readonly children: ReactNode }) => (
    <div className="max-w-focus mx-auto flex w-full flex-1 flex-col pb-16">
      {children}
    </div>
  ),
  project: ProjectFrame,
  site: ({ children }: { readonly children: ReactNode }) => (
    <div className="max-w-site mx-auto flex w-full flex-1 flex-col">
      {children}
    </div>
  ),
} as const satisfies Record<
  ShellName,
  (props: { readonly children: ReactNode }) => ReactNode
>;

/**
 * Each shell's gutter, from DESIGN.md's shell table, as the variable every
 * `GUTTER` inside it reads: the site's for the site, the docs and a focused
 * page, the project's for a project.
 */
export const SHELL_GUTTERS = {
  docs: "[--shell-gutter:var(--gutter-site)]",
  focus: "[--shell-gutter:var(--gutter-site)]",
  project: "[--shell-gutter:var(--gutter-project)]",
  site: "[--shell-gutter:var(--gutter-site)]",
} as const satisfies Record<ShellName, string>;

const FOOTED: ReadonlySet<ShellName> = new Set(["docs", "site"]);

const NO_READS: ShellReads = {};

export const AppShell = ({
  children,
  reads = NO_READS,
}: {
  readonly children: ReactNode;
  readonly reads?: ShellReads;
}) => {
  const pathname = useLocation({ select: (location) => location.pathname });
  const hydrated = useHydrated();
  const shell = useShellName();
  const Frame = FRAMES[shell];

  // An overlay belongs to the address it opened on: it is gone from the next
  // page.
  const [opened, setOpened] = useState<{
    readonly at: string;
    readonly overlay: Overlay;
  }>();

  const overlay = opened?.at === pathname ? opened.overlay : undefined;

  const open = useCallback(
    (next: Overlay) => {
      setOpened({ at: pathname, overlay: next });
    },
    [pathname]
  );

  const close = useCallback(() => {
    setOpened(undefined);
  }, []);

  const openDialog = useCallback(() => {
    open("keys");
  }, [open]);

  const controls = useMemo(() => ({ open }), [open]);

  return (
    <ShellContext value={controls}>
      <ShellReadsContext value={reads}>
        <ShellNameContext value={shell}>
          <KeysProvider openDialog={openDialog}>
            <SkipLink />
            <div
              className={`flex min-h-dvh flex-col ${SHELL_GUTTERS[shell]}`}
              data-shell={shell}
            >
              <TopBar shell={shell} />
              <Frame>{children}</Frame>
              {FOOTED.has(shell) ? <Footer /> : null}
            </div>
            {hydrated && LazyOverlays !== undefined ? (
              <Suspense fallback={null}>
                <LazyOverlays onClose={close} overlay={overlay} />
              </Suspense>
            ) : null}
          </KeysProvider>
        </ShellNameContext>
      </ShellReadsContext>
    </ShellContext>
  );
};
