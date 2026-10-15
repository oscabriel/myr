import type { Ask } from "@repo/protocol/domain/ask";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { familyMarks, markOf } from "./ask-progress.ts";
import type { AskProgress, Mark } from "./ask-progress.ts";
import { AppLink } from "./link.tsx";
import { StateMarkIcon } from "./marks.tsx";
import type { StateMark } from "./marks.tsx";
import { askPath } from "./paths.ts";

const words = {
  checking: "checking",
  claimed: "claimed",
  landed: "landed",
  open: "open",
  refused: "refused",
  waiting: "waiting",
} as const satisfies Record<Mark, string>;

const markFor = (mark: Mark): StateMark => mark;

const after = (id: string, prefix: string) =>
  id.startsWith(`${prefix}-`) ? id.slice(prefix.length + 1) : id;

export const shortNames = (
  parent: AskId,
  children: readonly AskId[]
): ReadonlyMap<AskId, string> => {
  const own = children.map((child) => after(child, parent));
  const [first] = own;
  const shared = first?.split("-")[0];

  const common =
    shared !== undefined &&
    own.length > 1 &&
    own.every((name) => name.startsWith(`${shared}-`))
      ? shared
      : undefined;

  return new Map(
    children.map((child, index) => {
      const name = own[index] ?? child;

      return [child, common === undefined ? name : after(name, common)];
    })
  );
};

const familyOf = (
  parent: Ask,
  states: ReadonlyMap<AskId, AskProgress>,
  finale: AskId | undefined
) => {
  const children = familyMarks(parent, states).children.filter(
    ({ ask }) => ask !== finale
  );

  const landed = children.filter(({ mark }) => mark === "landed").length;

  const names = shortNames(
    parent.id,
    children.map(({ ask }) => ask)
  );

  return {
    children,
    landed,
    nameOf: (ask: AskId) => names.get(ask) ?? ask,
    remaining: children.length - landed,
    total: children.length,
  };
};

interface FinaleState {
  readonly mark: StateMark;
  readonly words: string;
}

const finaleOf = (
  finale: AskId,
  states: ReadonlyMap<AskId, AskProgress>,
  remaining: number
): FinaleState => {
  if (states.get(finale)?.landed !== undefined) {
    return { mark: "landed", words: "landed" };
  }

  if (remaining > 0) {
    return { mark: "waiting", words: `waits for ${remaining}` };
  }

  const mark = markOf(states.get(finale));

  return {
    mark: markFor(mark),
    words: mark === "open" ? "open to take" : words[mark],
  };
};

const NODE =
  "text-label relative z-10 inline-flex min-w-0 items-center gap-1 no-underline hover:underline decoration-rule";

export const FamilyStrip = ({
  expanded,
  finale,
  parent,
  project,
  stamps,
  states,
  wants,
}: {
  readonly parent: Ask;
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly finale?: AskId;
  readonly stamps: ReadonlySet<AskId>;
  readonly project: ProjectName;
  readonly expanded: boolean;
  readonly wants?: ReadonlyMap<AskId, string>;
}) => {
  const [open, setOpen] = useState(expanded);
  const rowsId = useId();
  const family = familyOf(parent, states, finale);

  const end =
    finale === undefined
      ? undefined
      : finaleOf(finale, states, family.remaining);

  const plural = family.total === 1 ? "child" : "children";

  return (
    <div className="flex min-w-0 flex-col" data-family={parent.id}>
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <ol
          aria-label={`${parent.id}'s children`}
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
        >
          {family.children.map(({ ask, mark }, index) => (
            <li className="flex items-center gap-1.5" key={ask}>
              {index === 0 ? null : (
                <span aria-hidden="true" className="bg-rule h-px w-2.5" />
              )}
              <AppLink className={NODE} title={ask} to={askPath(project, ask)}>
                <StateMarkIcon
                  mark={markFor(mark)}
                  size="sm"
                  stamp={stamps.has(ask)}
                />
                <span className="text-mono max-tablet:sr-only font-mono">
                  {family.nameOf(ask)}
                </span>
                <span className="sr-only">, {words[mark]}</span>
              </AppLink>
            </li>
          ))}
        </ol>
        {finale === undefined || end === undefined ? null : (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="flex items-center">
              <span className="bg-rule h-px w-4" />
              <ArrowRight
                className="text-muted-foreground -ml-1 size-3"
                strokeWidth={1.75}
              />
            </span>
            <AppLink
              className={NODE}
              title={finale}
              to={askPath(project, finale)}
            >
              <StateMarkIcon
                mark={end.mark}
                size="sm"
                stamp={stamps.has(finale)}
              />
              <span className="text-mono max-tablet:sr-only font-mono">
                delete
              </span>
              <span className="sr-only"> {end.words}</span>
            </AppLink>
          </span>
        )}
        <span className="text-label text-muted-foreground ml-auto whitespace-nowrap tabular-nums">
          {family.landed} of {family.total} landed
        </span>
        <button
          aria-controls={rowsId}
          aria-expanded={open}
          className="text-muted-foreground hover:bg-surface hover:text-foreground relative z-10 inline-flex size-7 shrink-0 items-center justify-center transition-colors duration-[120ms]"
          onClick={() => {
            setOpen((now) => !now);
          }}
          title={`${open ? "Hide" : "Show"} ${family.total} ${plural}`}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform duration-[180ms] ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
          <span className="sr-only">
            {open ? "Hide" : "Show"} {family.total} {plural}
          </span>
        </button>
      </div>
      {/* Folded, the rows stay in the page: each open child's claim command is text an agent still finds. */}
      <ul
        className="border-rule mt-1 ml-[0.4375rem] flex flex-col border-l pl-3"
        hidden={!open}
        id={rowsId}
      >
        {family.children.map(({ ask, mark }) => (
          <li
            className="flex h-8 min-w-0 items-center gap-2"
            data-family-child={ask}
            key={ask}
          >
            <StateMarkIcon
              mark={markFor(mark)}
              size="sm"
              // A folded row is out of sight: its stamp would play unseen.
              stamp={open && stamps.has(ask)}
            />
            <AppLink
              className="text-ui decoration-rule relative z-10 min-w-0 truncate no-underline hover:underline"
              title={wants?.get(ask) ?? ask}
              to={askPath(project, ask)}
            >
              {wants?.get(ask) ?? (
                <span className="text-mono font-mono">
                  {family.nameOf(ask)}
                </span>
              )}
            </AppLink>
            {wants?.has(ask) === true ? (
              <span className="text-mono text-muted-foreground tablet:inline hidden shrink-0 font-mono">
                {family.nameOf(ask)}
              </span>
            ) : null}
            <span className="text-label text-muted-foreground ml-auto shrink-0">
              {words[mark]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Member = ({
  current,
  label,
  mark,
  project,
  ask,
  word,
}: {
  readonly ask: AskId;
  readonly current: boolean;
  readonly label: string;
  readonly mark: StateMark;
  readonly project: ProjectName;
  readonly word: string;
}) => (
  <AppLink
    aria-current={current ? "true" : undefined}
    className={`text-ui flex h-8 min-w-0 items-center gap-2 px-2 no-underline transition-colors duration-[120ms] ${
      current ? "bg-surface font-semibold" : "hover:bg-surface/50"
    }`}
    title={ask}
    to={askPath(project, ask)}
  >
    <StateMarkIcon mark={mark} size="sm" />
    <span className="text-mono min-w-0 truncate font-mono">{label}</span>
    <span className="text-label text-muted-foreground ml-auto shrink-0 font-normal">
      {word}
    </span>
  </AppLink>
);

export const FamilyTree = ({
  current,
  finale,
  parent,
  project,
  states,
}: {
  readonly parent: Ask;
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly finale?: AskId;
  readonly current?: AskId;
  readonly project: ProjectName;
}) => {
  const family = familyOf(parent, states, finale);
  const progress = markOf(states.get(parent.id));

  const own =
    progress === "open" &&
    parent.blockedBy.some((ask) => states.get(ask)?.landed === undefined)
      ? "waiting"
      : progress;

  const end =
    finale === undefined
      ? undefined
      : finaleOf(finale, states, family.remaining);

  return (
    <div className="flex min-w-0 flex-col" data-family={parent.id}>
      <Member
        ask={parent.id}
        current={current === parent.id}
        label={parent.id}
        mark={markFor(own)}
        project={project}
        word={`${family.landed} of ${family.total} landed`}
      />
      <ol
        aria-label={`${parent.id}'s children`}
        className="border-rule ml-[0.9375rem] flex flex-col border-l pl-1"
      >
        {family.children.map(({ ask, mark }) => (
          <li key={ask}>
            <Member
              ask={ask}
              current={current === ask}
              label={family.nameOf(ask)}
              mark={markFor(mark)}
              project={project}
              word={words[mark]}
            />
          </li>
        ))}
      </ol>
      {finale === undefined || end === undefined ? null : (
        <div className="mt-2">
          <Member
            ask={finale}
            current={current === finale}
            label="delete"
            mark={end.mark}
            project={project}
            word={end.words}
          />
        </div>
      )}
    </div>
  );
};
