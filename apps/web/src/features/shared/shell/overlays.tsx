/**
 * The shell's overlays, loaded once the page is up, so no page's first load
 * carries them: the rail as a sheet (Menu, below the shell's width), the
 * phone's More and Projects sheets, and the keys dialog. Each opens on a
 * press, slides in over 200 ms, traps focus, and closes on Escape, a press
 * outside or Close; following a link inside closes it too (the shell's open
 * overlay belongs to the address it opened on).
 */
import { Brand } from "@repo/brand";
import { useRouter } from "@tanstack/react-router";
import { Bot, Keyboard } from "lucide-react";
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
  /** The overlay open now; none when all are closed. */
  readonly overlay: Overlay | undefined;
  readonly onClose: () => void;
}

/** A sheet's or dialog's open state, as the shell holds it. */
const openState = (open: boolean, onClose: () => void) => ({
  onOpenChange: (next: boolean) => {
    if (!next) {
      onClose();
    }
  },
  open,
});

/** Whether the screen is at least a tablet's width, read when an overlay opens. */
const atLeastTablet = () => globalThis.matchMedia("(min-width: 40rem)").matches;

/**
 * Every project, with a typed filter: choosing one opens its asks. The
 * names, their posture and their open asks come from the list the rail
 * reads.
 */
const ProjectSwitcher = ({
  input,
  onChosen,
}: {
  /** The filter, which takes focus when the sheet opens. */
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
                    <>
                      <span className="text-muted-foreground text-label ml-auto tabular-nums">
                        {listing.openAsks} open
                      </span>
                      <PostureMark posture={listing.posture} />
                    </>
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

/** The phone's More: For agents, the project's sections, the keys, the session. */
const More = () => {
  const project = useCurrentProject();
  const listed = useProjectList();
  const { open } = useShell();

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
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

/**
 * Every overlay the shell has, each closed until the shell opens it. They
 * stay mounted once loaded, so each one slides in from closed.
 */
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
          <ProjectSwitcher input={filter} onChosen={onClose} />
        </SheetContent>
      </Sheet>
      <KeysDialog onClose={onClose} open={overlay === "keys"} />
    </>
  );
};

export default ShellOverlays;
