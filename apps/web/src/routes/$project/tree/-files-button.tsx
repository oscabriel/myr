/**
 * The Files button on the code pages below the shell's width, where the
 * rail is not drawn: it opens the files as a sheet from the left (the
 * whole screen on a phone), loaded on the first press. Not a route: the
 * `-` prefix keeps the router from reading it as one.
 */
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
        Files
      </Button>
      {FilesSheet === undefined || !open ? null : (
        <Suspense fallback={null}>
          <FilesSheet commit={commit} onOpenChange={setOpen} open={open} />
        </Suspense>
      )}
    </>
  );
};
