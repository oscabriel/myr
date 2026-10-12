import type { RefsView } from "@repo/protocol/domain/code";
import { GitBranch, GitCommitHorizontal, Tag } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { AppLink } from "../shared/link.tsx";
import { isCommitId } from "./headers.ts";
import { revLabel } from "./rev.ts";

const SHOWN = 100;

const RefMark = ({ rev }: { readonly rev: string }) => {
  if (rev === "main") {
    return (
      <GitBranch
        aria-hidden="true"
        className="size-4 shrink-0"
        strokeWidth={1.75}
      />
    );
  }

  return isCommitId(rev) ? (
    <GitCommitHorizontal
      aria-hidden="true"
      className="size-4 shrink-0"
      strokeWidth={1.75}
    />
  ) : (
    <Tag aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
  );
};

const ListFoot = ({
  count,
  read,
}: {
  readonly count: number;
  readonly read: boolean;
}) => {
  if (!read) {
    return (
      <p className="text-label text-muted-foreground px-2 pb-1">
        Reading the tags…
      </p>
    );
  }

  return count > SHOWN ? (
    <p className="text-label text-muted-foreground px-2 pb-1">
      {count - SHOWN} more: type to find them.
    </p>
  ) : null;
};

const ROW =
  "text-ui hover:bg-surface flex h-8 min-w-0 items-center gap-2 px-2 no-underline aria-[current]:bg-surface aria-[current]:font-semibold";

export const RefSwitcher = ({
  hrefAt,
  refs,
  rev,
}: {
  readonly rev: string;
  readonly refs?: RefsView | undefined;
  readonly hrefAt: (rev: string) => string;
}) => {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);

  const tags = (refs?.tags ?? [])
    .map(({ name }) => name)
    .filter((name) => name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={`Revision: ${revLabel(rev)}. Switch revision`}
        className="text-ui hover:bg-surface border-input flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 border px-2"
        data-ref={rev}
      >
        <RefMark rev={rev} />
        <span
          className={`min-w-0 truncate ${rev === "main" ? "" : "text-mono font-mono"}`}
        >
          {revLabel(rev)}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-1.5">
        <input
          aria-label="Find a tag"
          className="border-input bg-background sm:text-ui h-9 w-full border px-2 text-base sm:h-8"
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
          placeholder="Find a tag"
          value={filter}
        />
        <ul className="flex max-h-80 flex-col overflow-y-auto overscroll-contain">
          <li>
            <AppLink
              aria-current={rev === "main" ? "true" : undefined}
              className={ROW}
              onClick={() => {
                setOpen(false);
              }}
              to={hrefAt("main")}
            >
              <RefMark rev="main" />
              main
            </AppLink>
          </li>
          {tags.slice(0, SHOWN).map((name) => (
            <li data-tag={name} key={name}>
              <AppLink
                aria-current={rev === name ? "true" : undefined}
                className={ROW}
                onClick={() => {
                  setOpen(false);
                }}
                to={hrefAt(name)}
              >
                <RefMark rev={name} />
                <span className="text-mono min-w-0 truncate font-mono">
                  {name}
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
        <ListFoot count={tags.length} read={refs !== undefined} />
      </PopoverContent>
    </Popover>
  );
};
