import { useHydrated, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { Suspense, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { KeysProvider } from "../keys.tsx";
import { SkipLink } from "../layout.tsx";
import { docsPath } from "../paths.ts";
import { ShellContext, ShellReadsContext } from "./context.ts";
import type { Overlay, ShellReads } from "./context.ts";
import { DocsNav } from "./docs-nav.tsx";
import { Footer } from "./footer.tsx";
import { GUTTER } from "./gutter.ts";
import { LazyOverlays } from "./lazy-overlays.ts";
import { ShellNameContext, useShellName } from "./shells.ts";
import type { ShellName } from "./shells.ts";
import { TopBar } from "./top-bar.tsx";

/**
 * The project's container. A project's own pages draw their header and
 * side column inside it, from the project's route (`ProjectFrame`).
 */
const ProjectContainer = ({ children }: { readonly children: ReactNode }) => (
  <div className="max-w-project mx-auto flex w-full flex-1 flex-col">
    {children}
  </div>
);

/**
 * The article first, so it is read first; from `columns` the tree stands to
 * its left, parted by a rule the article's full height. Below `columns` the
 * index shows no tree under itself: the index already lists every page.
 */
const DocsFrame = ({ children }: { readonly children: ReactNode }) => {
  const index = useLocation({
    select: ({ pathname }) => pathname.replace(/\/$/u, "") === docsPath(),
  });

  return (
    <div className="columns:grid columns:grid-cols-[var(--column-docs-nav)_minmax(0,1fr)] flex w-full flex-1 flex-col">
      <div
        className={cn(
          "columns:col-start-2 columns:row-start-1 border-rule flex min-w-0 flex-col",
          index ? undefined : "columns:border-l"
        )}
      >
        {children}
      </div>
      <div
        className={cn(
          "border-rule columns:col-start-1 columns:row-start-1 columns:sticky columns:top-(--top-bar) columns:self-start columns:max-h-[calc(100dvh-var(--top-bar))] columns:overflow-y-auto columns:block columns:border-t-0 border-t py-6",
          index && "hidden",
          GUTTER
        )}
        data-docs-tree={index ? "index" : "page"}
      >
        <DocsNav />
      </div>
    </div>
  );
};

const FRAMES = {
  docs: DocsFrame,
  focus: ({ children }: { readonly children: ReactNode }) => (
    <div className="flex w-full flex-1 flex-col pb-16">{children}</div>
  ),
  project: ProjectContainer,
  site: ({ children }: { readonly children: ReactNode }) => (
    <div className="flex w-full flex-1 flex-col">{children}</div>
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

/**
 * The rails: from `tablet`, a hairline down each edge of the container, the
 * page's full height, with the top bar's box, the frame and the footer
 * between them (DESIGN.md "Rails"). The site and the docs are ruled at the
 * site's container, a focused page at its card's; a project is full-bleed.
 */
const RAILS = {
  docs: "max-w-site border-rule tablet:border-x mx-auto w-full",
  focus: "max-w-focus border-rule tablet:border-x mx-auto w-full",
  project: "",
  site: "max-w-site border-rule tablet:border-x mx-auto w-full",
} as const satisfies Record<ShellName, string>;

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
              className={cn(
                "flex min-h-dvh flex-col",
                shell === "project" ? "" : "tablet:px-(--frame-inset)"
              )}
            >
              <div
                className={`flex flex-1 flex-col ${SHELL_GUTTERS[shell]} ${RAILS[shell]}`}
                data-shell={shell}
              >
                <TopBar shell={shell} />
                <Frame>{children}</Frame>
                {FOOTED.has(shell) ? <Footer /> : null}
              </div>
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
