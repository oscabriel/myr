import { useLocation } from "@tanstack/react-router";
import { ChevronLeft, ChevronsUpDown, Menu } from "lucide-react";

import { Button } from "../../../components/ui/button.tsx";
import { SessionSlot } from "../../auth/session-slot.tsx";
import { AppLink } from "../link.tsx";
import { useCurrentProject, useShell } from "./context.ts";
import { Wordmark } from "./rail.tsx";
import { crumbsFor } from "./sections.ts";

const parentOf = (pathname: string) => {
  const crumbs = crumbsFor(pathname);
  const parent = crumbs.at(-2);

  return crumbs.length >= 3 && parent?.to !== undefined
    ? { label: parent.label, to: parent.to }
    : undefined;
};

export const TopBar = () => {
  const { open } = useShell();
  const project = useCurrentProject();
  const parent = useLocation({ select: ({ pathname }) => parentOf(pathname) });

  return (
    <header className="border-rule bg-background tablet:h-12 tablet:px-3 shell:hidden sticky top-0 z-30 flex h-11 shrink-0 items-center gap-1 border-b px-2">
      <Button
        className="tablet:inline-flex hidden"
        onClick={() => {
          open("menu");
        }}
        size="sm"
        variant="ghost"
      >
        <Menu aria-hidden="true" strokeWidth={1.75} />
        Menu
      </Button>
      {parent === undefined ? (
        <Wordmark className="px-2" />
      ) : (
        <>
          <AppLink
            className="text-ui hover:bg-surface tablet:hidden flex h-8 min-w-0 items-center gap-1 pr-2 pl-1 no-underline"
            to={parent.to}
          >
            <ChevronLeft
              aria-hidden="true"
              className="size-4 shrink-0"
              strokeWidth={1.75}
            />
            <span className="min-w-0 truncate">{parent.label}</span>
          </AppLink>
          <Wordmark className="tablet:inline hidden px-2" />
        </>
      )}
      {project === undefined ? null : (
        <Button
          aria-label={`Project: ${project}. Switch project`}
          className="text-ui ml-1 max-w-[45vw] min-w-0 font-semibold"
          onClick={() => {
            open("projects");
          }}
          size="sm"
          variant="outline"
        >
          <span className="min-w-0 truncate">{project}</span>
          <ChevronsUpDown
            aria-hidden="true"
            className="text-muted-foreground"
            strokeWidth={1.75}
          />
        </Button>
      )}
      <div className="tablet:flex ml-auto hidden min-w-0 items-center">
        <SessionSlot />
      </div>
    </header>
  );
};
