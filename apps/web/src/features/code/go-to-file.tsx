import type { ProjectName } from "@repo/protocol/ids";
import { Search } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

import { inField, useKeys } from "../shared/keys.tsx";

/** The finder's dialog, loaded by the page's route when it first opens; none on the server. */
export type FileFinder = ComponentType<{
  readonly onClose: () => void;
  readonly project: ProjectName;
  readonly rev: string;
}>;

/** `t` opens it, as in other code browsers; never in a field, and not while single-key shortcuts are off. */
export const goToFilePress = (
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
  on: boolean
) =>
  on && event.key === "t" && !event.altKey && !event.ctrlKey && !event.metaKey;

export const GoToFile = ({
  Finder,
  project,
  rev,
}: {
  readonly Finder: FileFinder | undefined;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const [open, setOpen] = useState(false);
  const on = useKeys()?.on ?? true;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !inField(event) &&
        goToFilePress(event, on)
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };

    globalThis.addEventListener("keydown", onKey);

    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [on]);

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
        size="sm"
        title="Go to file (t)"
        variant="outline"
      >
        <Search aria-hidden="true" strokeWidth={1.75} />
        <span className="tablet:not-sr-only sr-only">Go to file</span>
        <Kbd aria-hidden="true" className="shell:inline-flex hidden">
          t
        </Kbd>
      </Button>
      {Finder === undefined || !open ? null : (
        <Suspense fallback={null}>
          <Finder
            onClose={() => {
              setOpen(false);
            }}
            project={project}
            rev={rev}
          />
        </Suspense>
      )}
    </>
  );
};
