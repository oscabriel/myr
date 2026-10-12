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
