/**
 * Go to file's dialog: the repository's paths at the page's revision, the
 * ones that match what the reader types, each opening its file. Loaded only
 * when it first opens.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ProjectName } from "@repo/protocol/ids";
import { useRouter } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { File } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { pathsAtom } from "../../../../client/code.ts";
import { filesMatching } from "../../../../features/code/file-match.ts";
import { blobHref } from "../../../../features/code/paths.ts";
import { revLabel } from "../../../../features/code/rev.ts";
import { AppLink } from "../../../../features/shared/link.tsx";

const ROW =
  "text-ui hover:bg-surface focus-visible:bg-surface flex min-h-8 min-w-0 items-center gap-2 px-2 py-1 no-underline";

const Found = ({
  onClose,
  project,
  query,
  rev,
}: {
  readonly onClose: () => void;
  readonly project: ProjectName;
  readonly query: string;
  readonly rev: string;
}) => {
  const read = useAtomValue(pathsAtom({ at: rev, project }));
  const listed = Option.getOrUndefined(AsyncResult.value(read));

  const found = useMemo(
    () => filesMatching(listed?.paths ?? [], query),
    [listed, query]
  );

  if (listed === undefined) {
    return (
      <p className="text-ui text-muted-foreground px-2 py-1">
        {AsyncResult.isFailure(read)
          ? "The paths could not be read. Browse the tree instead."
          : "Reading the paths…"}
      </p>
    );
  }

  return found.length === 0 ? (
    <p className="text-ui text-muted-foreground px-2 py-1">No file matches.</p>
  ) : (
    <ul className="flex max-h-[min(24rem,60dvh)] flex-col overflow-y-auto overscroll-contain">
      {found.map((path) => (
        <li key={path}>
          <AppLink
            className={ROW}
            onClick={onClose}
            to={blobHref(project, rev, path)}
          >
            <File
              aria-hidden="true"
              className="text-muted-foreground size-4 shrink-0"
              strokeWidth={1.75}
            />
            <span className="text-mono min-w-0 truncate font-mono">{path}</span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
};

const FileFinder = ({
  onClose,
  project,
  rev,
}: {
  readonly onClose: () => void;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const router = useRouter();
  const [query, setQuery] = useState("");

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="gap-3 sm:max-w-lg">
        <DialogTitle>Go to file</DialogTitle>
        <DialogDescription>
          Files at <span className="text-mono font-mono">{revLabel(rev)}</span>.
          Enter opens the first.
        </DialogDescription>
        <input
          aria-label="File path"
          className="border-input bg-background sm:text-ui h-9 w-full border px-2 text-base sm:h-8"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            const first = event.currentTarget
              .closest("[data-slot=dialog-content]")
              ?.querySelector("li a")
              ?.getAttribute("href");

            if (
              event.key === "Enter" &&
              first !== undefined &&
              first !== null
            ) {
              event.preventDefault();
              onClose();
              router.history.push(first);
            }
          }}
          placeholder="Type part of a path"
          value={query}
        />
        <Found onClose={onClose} project={project} query={query} rev={rev} />
      </DialogContent>
    </Dialog>
  );
};

// `React.lazy` takes a module's default export.
export default FileFinder;
