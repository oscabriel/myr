import { useHydrated, useLocation, useMatches } from "@tanstack/react-router";
import { Suspense, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { KeysProvider } from "../keys.tsx";
import { SkipLink } from "../layout.tsx";
import { BottomBar } from "./bottom-bar.tsx";
import { ShellContext, ShellReadsContext } from "./context.ts";
import type { Overlay, ShellReads } from "./context.ts";
import { LazyOverlays } from "./lazy-overlays.ts";
import { Rail } from "./rail.tsx";
import { TopBar } from "./top-bar.tsx";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    readonly shell?: "bare";
  }
}

const useBare = () =>
  useMatches({
    select: (matches) =>
      matches.some(({ staticData }) => staticData.shell === "bare"),
  });

export const AppShell = ({
  children,
  projects,
  todayCount,
}: ShellReads & { readonly children: ReactNode }) => {
  const pathname = useLocation({ select: (location) => location.pathname });
  const hydrated = useHydrated();
  const bare = useBare();

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

  const shell = useMemo(() => ({ open }), [open]);

  const reads = useMemo(
    () => ({ projects, todayCount }),
    [projects, todayCount]
  );

  if (bare) {
    return children;
  }

  return (
    <ShellContext value={shell}>
      <ShellReadsContext value={reads}>
        <KeysProvider openDialog={openDialog}>
          <SkipLink />
          <div className="shell:h-dvh shell:overflow-hidden tablet:pb-0 flex min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
            <Rail />
            <div className="shell:flex-row flex min-w-0 flex-1 flex-col">
              <TopBar />
              {children}
            </div>
          </div>
          <BottomBar />
          {hydrated && LazyOverlays !== undefined ? (
            <Suspense fallback={null}>
              <LazyOverlays onClose={close} overlay={overlay} />
            </Suspense>
          ) : null}
        </KeysProvider>
      </ShellReadsContext>
    </ShellContext>
  );
};
