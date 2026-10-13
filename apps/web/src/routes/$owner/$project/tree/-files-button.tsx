import { FolderTree } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";

const FilesSheet = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./-files-sheet.tsx"));

export const FilesButton = ({
  commit = false,
}: {
  readonly commit?: boolean;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
        size="sm"
        variant="outline"
      >
        <FolderTree aria-hidden="true" strokeWidth={1.75} />
        {/* Not "Files": the bar's toggle beside it is Files | Commits. */}
        {commit ? "Changed files" : "Tree"}
      </Button>
      {FilesSheet === undefined || !open ? null : (
        <Suspense fallback={null}>
          <FilesSheet commit={commit} onOpenChange={setOpen} open={open} />
        </Suspense>
      )}
    </>
  );
};
