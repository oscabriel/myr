/**
 * The code pages' files below the shell's width: a sheet from the left on
 * a tablet, the whole screen on a phone, holding the ref line and the
 * tree (or a commit's changed files). Choosing a file moves the page, and
 * the sheet closes. Loaded on the first press of Files. Not a route: the
 * `-` prefix keeps the router from reading it as one.
 */
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Sheet, SheetContent } from "@/components/ui/sheet";

import { TABLET_QUERY, useMedia } from "../../../../features/code/media.ts";
import { CodeFiles, CommitFiles } from "./-rail-body.tsx";

const FilesSheet = ({
  commit,
  onOpenChange,
  open,
}: {
  readonly commit: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) => {
  const tablet = useMedia(TABLET_QUERY);

  const href = useLocation({
    select: ({ hash, pathname }) => `${pathname}#${hash}`,
  });

  const opened = useRef(href);

  // The reader chose a file: the page moved, so the sheet has done its work.
  useEffect(() => {
    if (href !== opened.current) {
      onOpenChange(false);
    }
  }, [href, onOpenChange]);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        side={tablet ? "left" : "full"}
        title={commit ? "Changed files" : "Files"}
      >
        <div className="flex h-full min-h-0 flex-col">
          {commit ? <CommitFiles always /> : <CodeFiles always />}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default FilesSheet;
