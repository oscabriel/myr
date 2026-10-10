/**
 * The Files button on a finish's page below the shell's width, where the
 * rail is not drawn: it opens the changed files as a sheet from the left,
 * loaded on its first press. `import.meta.env.SSR` is `true` in the
 * Worker's build, so the Worker bundles none of the sheet.
 */
import { FolderTree } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "../../components/ui/button.tsx";

const Sheet = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./finish-files-sheet.tsx"));

/** The changed files below the shell's width: a Files button, and the list as a sheet, loaded on its first press. */
export const FinishFilesButton = () => {
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
      {Sheet === undefined || !open ? null : (
        <Suspense fallback={null}>
          <Sheet onOpenChange={setOpen} open={open} />
        </Suspense>
      )}
    </>
  );
};
