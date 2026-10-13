/**
 * The code bar's ref switcher (ADR 0043): `main`, the project's tags, and the
 * answers in forks, each with its claimant, ask and claim state. A fork's
 * entry opens the same page in that fork, at its address
 * (`@<handle>/<ask>`), never its repo's name.
 */
import { forkRev } from "@repo/protocol/domain/code";
import type { ForkRef, RefsView } from "@repo/protocol/domain/code";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import {
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Tag,
} from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { AppLink } from "../shared/link.tsx";
import { StateMarkIcon } from "../shared/marks.tsx";
import { CLAIM_STATES } from "../shared/row.tsx";
import { isCommitId } from "./headers.ts";
import { isForkRev, readsFork, revLabel } from "./rev.ts";

const SHOWN = 100;

const ICON = "size-4 shrink-0";

const RefMark = ({ rev }: { readonly rev: string }) => {
  if (rev === "main") {
    return <GitBranch aria-hidden="true" className={ICON} strokeWidth={1.75} />;
  }

  if (isForkRev(rev)) {
    return <GitFork aria-hidden="true" className={ICON} strokeWidth={1.75} />;
  }

  return isCommitId(rev) ? (
    <GitCommitHorizontal
      aria-hidden="true"
      className={ICON}
      strokeWidth={1.75}
    />
  ) : (
    <Tag aria-hidden="true" className={ICON} strokeWidth={1.75} />
  );
};

const ROW =
  "text-ui hover:bg-surface flex min-h-8 min-w-0 items-center gap-2 px-2 py-1 no-underline aria-[current]:bg-surface aria-[current]:font-semibold";

const GROUP = "text-label text-muted-foreground px-2 pt-2 pb-1 font-medium";

/** A claim fork that holds an answer: the only forks the switcher lists. */
type AnswerFork = ForkRef & { readonly ask: AskId };

const answerForks = (refs: RefsView | undefined): readonly AnswerFork[] =>
  (refs?.forks ?? []).flatMap((fork) =>
    fork.kind === "claim" && fork.ask !== undefined
      ? [{ ...fork, ask: fork.ask }]
      : []
  );

const matches = (filter: string) => (text: string) =>
  text.toLowerCase().includes(filter.trim().toLowerCase());

const ForkEntry = ({
  fork,
  hrefAt,
  onPick,
  rev,
}: {
  readonly fork: AnswerFork;
  readonly hrefAt: (rev: string) => string;
  readonly onPick: () => void;
  readonly rev: string;
}) => {
  const state = fork.state === undefined ? undefined : CLAIM_STATES[fork.state];

  return (
    <li data-fork={`${fork.handle}/${fork.ask}`}>
      <AppLink
        aria-current={readsFork(rev, fork) ? "true" : undefined}
        className={ROW}
        onClick={onPick}
        to={hrefAt(forkRev(fork))}
      >
        {state === undefined ? (
          <GitFork aria-hidden="true" className={ICON} strokeWidth={1.75} />
        ) : (
          <StateMarkIcon className={ICON} mark={state.mark} />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-mono min-w-0 truncate font-mono">
            {fork.ask}
          </span>
          <span className="text-label text-muted-foreground min-w-0 truncate">
            {fork.handle}
            {state === undefined ? null : ` · ${state.word}`}
          </span>
        </span>
      </AppLink>
    </li>
  );
};

/**
 * What the switcher lists, once the refs are read: `main`, the tags a filter
 * leaves, and the answers in forks.
 */
export const RefChoices = ({
  filter = "",
  hrefAt,
  onPick,
  refs,
  rev,
}: {
  readonly filter?: string;
  readonly hrefAt: (rev: string) => string;
  readonly onPick: () => void;
  /** The project whose refs these are: the reader reads them by it. */
  readonly project: ProjectName;
  readonly refs: RefsView | undefined;
  readonly rev: string;
}) => {
  const found = matches(filter);
  const tags = (refs?.tags ?? []).map(({ name }) => name).filter(found);

  const forks = answerForks(refs).filter(
    (fork) => found(fork.ask) || found(fork.handle)
  );

  return (
    <div className="flex max-h-80 flex-col overflow-y-auto overscroll-contain">
      <p className={GROUP}>Branch</p>
      <ul>
        <li data-ref-choice="main">
          <AppLink
            aria-current={rev === "main" ? "true" : undefined}
            className={ROW}
            onClick={onPick}
            to={hrefAt("main")}
          >
            <RefMark rev="main" />
            main
            <span className="text-label text-muted-foreground ml-auto">
              moves only by a landing
            </span>
          </AppLink>
        </li>
      </ul>
      {refs === undefined ? (
        <p className="text-label text-muted-foreground px-2 py-1">
          Reading the tags and forks…
        </p>
      ) : null}
      {tags.length === 0 ? null : (
        <>
          <p className={GROUP}>Tags</p>
          <ul>
            {tags.slice(0, SHOWN).map((name) => (
              <li data-tag={name} key={name}>
                <AppLink
                  aria-current={rev === name ? "true" : undefined}
                  className={ROW}
                  onClick={onPick}
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
          {tags.length > SHOWN ? (
            <p className="text-label text-muted-foreground px-2 pb-1">
              {tags.length - SHOWN} more: type to find them.
            </p>
          ) : null}
        </>
      )}
      {forks.length === 0 ? null : (
        <>
          <p className={GROUP}>Answers in forks</p>
          <ul>
            {forks.map((fork) => (
              <ForkEntry
                fork={fork}
                hrefAt={hrefAt}
                key={`${fork.handle}/${fork.ask}`}
                onPick={onPick}
                rev={rev}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

/** What the switcher lists once open: the page's route reads the refs and hands them to `RefChoices`. */
export type RefChoicesReader = ComponentType<{
  readonly filter: string;
  readonly hrefAt: (rev: string) => string;
  readonly onPick: () => void;
  readonly project: ProjectName;
  readonly rev: string;
}>;

/** The refs are read when the list first opens, never for the page's first paint. */
export const RefSwitcher = ({
  Choices,
  hrefAt,
  project,
  rev,
}: {
  readonly Choices: RefChoicesReader;
  readonly hrefAt: (rev: string) => string;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={`Revision: ${revLabel(rev)}. Switch revision`}
        className="text-ui hover:bg-surface border-input flex h-8 max-w-[16rem] min-w-0 shrink-0 cursor-pointer items-center gap-2 border px-2"
        data-ref={rev}
      >
        <RefMark rev={rev} />
        <span
          className={`min-w-0 truncate ${rev === "main" ? "" : "text-mono font-mono"}`}
        >
          {revLabel(rev)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-3.5 shrink-0"
          strokeWidth={1.75}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1 p-1.5">
        <input
          aria-label="Find a tag or fork"
          className="border-input bg-background sm:text-ui h-9 w-full border px-2 text-base sm:h-8"
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
          placeholder="Find a tag or fork"
          value={filter}
        />
        {open ? (
          <Choices
            filter={filter}
            hrefAt={hrefAt}
            onPick={close}
            project={project}
            rev={rev}
          />
        ) : null}
        <AppLink
          className="text-ui text-muted-foreground hover:text-foreground border-rule border-t px-2 pt-2 pb-1 no-underline"
          onClick={close}
          to={`/${project}/refs`}
        >
          Every ref, with its commit
        </AppLink>
      </PopoverContent>
    </Popover>
  );
};
