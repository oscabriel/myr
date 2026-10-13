import { Brand } from "@repo/brand";
import { Menu, Search } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button.tsx";
import { AppLink } from "../link.tsx";
import { ASKS_PATH, docsPath, EXPLORE_PATH, INSTALL_PATH } from "../paths.ts";
import { Account } from "./account.tsx";
import { useShell } from "./context.ts";
import { GUTTER } from "./gutter.ts";
import type { ShellName } from "./shells.ts";

const EXACT = { exact: true, includeSearch: false } as const;

/** The same four in every shell but the focused one, in this order. */
export const SITE_LINKS = [
  { label: "Explore", to: EXPLORE_PATH },
  { label: "Asks", to: ASKS_PATH },
  { label: "Docs", to: docsPath() },
  { label: "Install", to: INSTALL_PATH },
] as const;

const LINK =
  "text-ui text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground flex h-8 items-center px-2 no-underline transition-colors duration-[120ms] aria-[current=page]:font-medium";

/** The name in the UI sans, and no mark (the maintainer's overrides, 4). */
export const Wordmark = () => (
  <AppLink
    activeOptions={EXACT}
    className="text-want text-foreground shrink-0 font-semibold tracking-[-0.015em] no-underline"
    to="/"
  >
    {Brand.name}
  </AppLink>
);

export const SiteLinks = ({ className }: { readonly className: string }) => (
  <nav aria-label="Primary" className={className}>
    {SITE_LINKS.map(({ label, to }) => (
      <AppLink
        activeOptions={{ includeSearch: false }}
        className={LINK}
        key={to}
        to={to}
      >
        {label}
      </AppLink>
    ))}
  </nav>
);

/**
 * The colour comes from around the button: the kit merges classes, reads an
 * unknown `text-*` as a colour, and would drop the button's `text-ui` size.
 */
const Quiet = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-muted-foreground flex shrink-0">{children}</span>
);

const Controls = () => {
  const { open } = useShell();

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2">
      <Button
        onClick={() => {
          open("projects");
        }}
        size="sm"
        variant="outline"
      >
        <Search aria-hidden="true" strokeWidth={1.75} />
        <span className="tablet:not-sr-only sr-only">Search</span>
      </Button>
      <Account />
      <Quiet>
        <Button
          aria-label="Open navigation"
          className="nav:hidden"
          onClick={() => {
            open("menu");
          }}
          size="sm"
          variant="ghost"
        >
          <Menu aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </Quiet>
    </div>
  );
};

const BAR = "flex h-14 min-w-0 items-center gap-4";

/**
 * Framed in the site and the docs (inside the container, its hairline too),
 * full-bleed in a project, and the wordmark alone in a focused page.
 */
export const TopBar = ({ shell }: { readonly shell: ShellName }) => {
  if (shell === "focus") {
    return (
      <header
        className={`max-w-focus mx-auto w-full ${GUTTER} ${BAR}`}
        data-top-bar="focus"
      >
        <Wordmark />
      </header>
    );
  }

  const inside = (
    <>
      <Wordmark />
      <SiteLinks className="nav:flex hidden items-center gap-1" />
      <Controls />
    </>
  );

  return shell === "project" ? (
    <header
      className={`border-rule bg-background sticky top-0 z-30 border-b ${GUTTER} ${BAR}`}
      data-top-bar="full-bleed"
    >
      {inside}
    </header>
  ) : (
    <header className="bg-background sticky top-0 z-30" data-top-bar="framed">
      <div
        className={`border-rule max-w-site mx-auto border-b ${GUTTER} ${BAR}`}
      >
        {inside}
      </div>
    </header>
  );
};
