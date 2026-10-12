import { Brand } from "@repo/brand";
import { useRouter } from "@tanstack/react-router";
import { BookOpen, Bot, FolderInput, Keyboard } from "lucide-react";
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
import { SessionSlot } from "../../auth/session-slot.tsx";
import { KeysHelp, useKeys } from "../keys.tsx";
import { AppLink } from "../link.tsx";
import { docsPath, IMPORT_PATH } from "../paths.ts";
import { useCurrentProject, useProjectList, useShell } from "./context.ts";
import type { Overlay } from "./context.ts";
import {
  PostureMark,
  ProjectSectionList,
  RAIL_ROW,
  RailContent,
  RailFoot,
} from "./rail.tsx";

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

const atLeastTablet = () => globalThis.matchMedia("(min-width: 40rem)").matches;

const ProjectSwitcher = ({
  input,
  onChosen,
}: {
  readonly input: RefObject<HTMLInputElement | null>;
  readonly onChosen: () => void;
}) => {
  const listed = useProjectList();
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
  onChosen,
}: {
  readonly input: RefObject<HTMLInputElement | null>;
  readonly onChosen: () => void;
}) => (
  <>
    <ProjectSwitcher input={input} onChosen={onChosen} />
    <div className="border-rule border-t p-1">
      <AppLink className={RAIL_ROW} to={IMPORT_PATH}>
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

const More = () => {
  const project = useCurrentProject();
  const listed = useProjectList();
  const { open } = useShell();

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
      <AppLink
        activeOptions={{ exact: true }}
        className={RAIL_ROW}
        to={docsPath()}
      >
        <BookOpen
          aria-hidden="true"
          className="text-muted-foreground size-4"
          strokeWidth={1.75}
        />
        Docs
      </AppLink>
      <AppLink
        activeOptions={{ exact: true }}
        className={RAIL_ROW}
        to="/agents"
      >
        <Bot
          aria-hidden="true"
          className="text-muted-foreground size-4"
          strokeWidth={1.75}
        />
        For agents
      </AppLink>
      {project === undefined ? null : (
        <div className="flex flex-col gap-1">
          <h2 className="text-label text-muted-foreground px-2 pt-3 pb-1">
            {project}
          </h2>
          <ProjectSectionList
            openAsks={
              listed?.find((listing) => listing.project === project)?.openAsks
            }
            project={project}
          />
        </div>
      )}
      <button
        className={`${RAIL_ROW} w-full cursor-pointer`}
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
      <div className="border-rule mt-1 border-t px-2 pt-3 pb-1">
        <SessionSlot layout="rail" />
      </div>
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
const ShellOverlays = ({ onClose, overlay }: OverlayProps) => {
  const filter = useRef<HTMLInputElement>(null);

  return (
    <>
      <Sheet {...openState(overlay === "menu", onClose)}>
        <SheetContent side="left" title={Brand.name}>
          <div className="flex min-h-full flex-col">
            <div className="flex-1">
              <RailContent />
            </div>
            <RailFoot />
          </div>
        </SheetContent>
      </Sheet>
      <Sheet {...openState(overlay === "more", onClose)}>
        <SheetContent side="bottom" title="More">
          <More />
        </SheetContent>
      </Sheet>
      <Sheet {...openState(overlay === "projects", onClose)}>
        <SheetContent
          initialFocus={filter}
          side={overlay === "projects" && atLeastTablet() ? "left" : "full"}
          title="Projects"
        >
          <ProjectsSheetBody input={filter} onChosen={onClose} />
        </SheetContent>
      </Sheet>
      <KeysDialog onClose={onClose} open={overlay === "keys"} />
    </>
  );
};

export default ShellOverlays;
