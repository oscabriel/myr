import { Brand } from "@repo/brand";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { useRouter } from "@tanstack/react-router";
import { FolderInput, Keyboard } from "lucide-react";
import { useRef } from "react";
import type { RefObject } from "react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../../../components/ui/combobox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.tsx";
import { Sheet, SheetContent } from "../../../components/ui/sheet.tsx";
import { PostureMark } from "../../project/posture-mark.tsx";
import { KeysHelp, useKeys } from "../keys.tsx";
import { AppLink } from "../link.tsx";
import { IMPORT_PATH } from "../paths.ts";
import { useCurrentProject, useShell, useShellReads } from "./context.ts";
import type { Overlay } from "./context.ts";
import { SITE_LINKS } from "./top-bar.tsx";

export interface OverlayProps {
  readonly overlay: Overlay | undefined;
  readonly onClose: () => void;
}

const openState = (open: boolean, onClose: () => void) => ({
  onOpenChange: (next: boolean) => {
    if (!next) {
      onClose();
    }
  },
  open,
});

const ROW =
  "text-ui text-foreground hover:bg-surface flex h-10 min-w-0 items-center gap-2.5 px-3 no-underline transition-colors duration-[120ms] focus-visible:outline-offset-[-2px] [&[aria-current]]:font-semibold";

const atLeastTablet = () => globalThis.matchMedia("(min-width: 40rem)").matches;

const ProjectSwitcher = ({
  input,
  listed,
  onChosen,
}: {
  readonly input: RefObject<HTMLInputElement | null>;
  readonly listed: readonly ProjectListing[] | undefined;
  readonly onChosen: () => void;
}) => {
  const current = useCurrentProject();
  const router = useRouter();
  const names = (listed ?? []).map(({ project }) => project);

  return (
    <Combobox
      autoHighlight
      inline
      items={names}
      onValueChange={(name) => {
        if (name !== null) {
          onChosen();
          router.history.push(`/${name}`);
        }
      }}
      open
      value={current ?? null}
    >
      <div className="border-rule border-b p-3">
        <ComboboxInput
          aria-label="Find a project"
          className="w-full"
          placeholder="Find a project"
          ref={input}
          showTrigger={false}
        />
      </div>
      {listed === undefined ? (
        <p className="text-ui text-muted-foreground p-4">
          Reading the projects…
        </p>
      ) : (
        <>
          <ComboboxEmpty className="p-4">
            No project by that name.
          </ComboboxEmpty>
          <ComboboxList className="max-h-none p-1">
            {(name: string) => {
              const listing = listed.find(({ project }) => project === name);

              return (
                <ComboboxItem className="h-10 gap-3" key={name} value={name}>
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  {listing === undefined ? null : (
                    <span className="ml-auto flex shrink-0 items-center gap-3">
                      <span className="text-muted-foreground text-label tabular-nums">
                        {listing.openAsks} open
                      </span>
                      <PostureMark posture={listing.posture} />
                    </span>
                  )}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </>
      )}
    </Combobox>
  );
};

export const ProjectsSheetBody = ({
  input,
  listed,
  onChosen,
}: {
  readonly input: RefObject<HTMLInputElement | null>;
  readonly listed: readonly ProjectListing[] | undefined;
  readonly onChosen: () => void;
}) => (
  <>
    <ProjectSwitcher input={input} listed={listed} onChosen={onChosen} />
    <div className="border-rule border-t p-1">
      <AppLink className={ROW} to={IMPORT_PATH}>
        <FolderInput
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
          strokeWidth={1.75}
        />
        Import a repo
      </AppLink>
    </div>
  </>
);

/** Below `nav` the top bar's links fold into this sheet, with the keys' list. */
export const MenuBody = () => {
  const { open } = useShell();

  return (
    <div className="flex flex-col gap-1 px-1 py-2">
      {SITE_LINKS.map(({ label, to }) => (
        <AppLink
          activeOptions={{ includeSearch: false }}
          className={ROW}
          key={to}
          to={to}
        >
          {label}
        </AppLink>
      ))}
      <button
        className={`${ROW} w-full cursor-pointer`}
        onClick={() => {
          open("keys");
        }}
        type="button"
      >
        <Keyboard
          aria-hidden="true"
          className="text-muted-foreground size-4"
          strokeWidth={1.75}
        />
        Keys
      </button>
    </div>
  );
};

const KeysDialog = ({
  onClose,
  open,
}: {
  readonly onClose: () => void;
  readonly open: boolean;
}) => {
  const keys = useKeys();

  return (
    <Dialog {...openState(open, onClose)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keys</DialogTitle>
          <DialogDescription>
            Every key has a twin you can click: rows are links, files are rows
            of the tree, and commands have their copy buttons.
          </DialogDescription>
        </DialogHeader>
        <KeysHelp
          on={keys?.on ?? true}
          onChange={(on) => {
            keys?.setOn(on);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

/** They stay mounted once loaded, so each one slides in from closed. */
/** The list is read while the search is open, never by the shell on every page. */
const ListedProjects = ({
  input,
  onChosen,
}: {
  readonly input: RefObject<HTMLInputElement | null>;
  readonly onChosen: () => void;
}) => {
  const { ReadProjects } = useShellReads();

  return ReadProjects === undefined ? (
    <ProjectsSheetBody input={input} listed={undefined} onChosen={onChosen} />
  ) : (
    <ReadProjects>
      {(listed) => (
        <ProjectsSheetBody input={input} listed={listed} onChosen={onChosen} />
      )}
    </ReadProjects>
  );
};

const ShellOverlays = ({ onClose, overlay }: OverlayProps) => {
  const filter = useRef<HTMLInputElement>(null);

  return (
    <>
      <Sheet {...openState(overlay === "menu", onClose)}>
        <SheetContent side="right" title={Brand.name}>
          <MenuBody />
        </SheetContent>
      </Sheet>
      <Sheet {...openState(overlay === "projects", onClose)}>
        <SheetContent
          initialFocus={filter}
          side={overlay === "projects" && atLeastTablet() ? "left" : "full"}
          title="Search projects"
        >
          <ListedProjects input={filter} onChosen={onClose} />
        </SheetContent>
      </Sheet>
      <KeysDialog onClose={onClose} open={overlay === "keys"} />
    </>
  );
};

export default ShellOverlays;
