/**
 * A family as a fan: a parent ask split into sibling children, one per
 * module, and a delete child that waits for all of them. The children are
 * siblings, so they are drawn side by side on one bus, never as a ladder,
 * with an arrow to the delete child at the end.
 *
 * - `FamilyStrip` is a parent row's third line: each child's mark and its
 *   short name, the arrow to the delete child, "n of N landed", and a
 *   button that lists the children as rows beneath. N is the children the
 *   parent stores, never the listing's remaining blockers (a listing drops
 *   the ones that landed).
 * - `FamilyTree` is the vertical form, for the inspector and the top of a
 *   member's page: the parent, its children on a left bus, then the delete
 *   child, the member being read marked.
 *
 * A child that lands while the page is open settles with the stamp, once
 * (the caller's `stamps`, from `stampsFrom`); the count changes with no
 * motion of its own, and with reduced motion nothing moves.
 */
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

/** Each child's state in the words its node is read by. */
const words = {
  checking: "checking",
  claimed: "claimed",
  landed: "landed",
  open: "open",
  refused: "refused",
  waiting: "waiting",
} as const satisfies Record<Mark, string>;

/** The fold's marks are named as the marks are. */
const markFor = (mark: Mark): StateMark => mark;

/** The words of `id` after `prefix` and its dash, or `id` when it does not start so. */
const after = (id: string, prefix: string) =>
  id.startsWith(`${prefix}-`) ? id.slice(prefix.length + 1) : id;

/**
 * Each child's short name: its id after the parent's, and after any word
 * every sibling shares ("drop-legacy-fetch-burrow-auth" reads "auth" when
 * every child is a burrow module).
 */
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

/** A family's children (the delete child apart), their marks and what the delete child waits on. */
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

/** Where the delete child stands: its mark, and its state in words. */
interface FinaleState {
  readonly mark: StateMark;
  readonly words: string;
}

/** The delete child's state: it waits until every child lands, then opens, then lands. */
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

/** A row's third line: the fan, the count, and the children as rows on demand. */
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
  /** The delete child, when the family has one. */
  readonly finale?: AskId;
  /** Children that landed while the page was open. */
  readonly stamps: ReadonlySet<AskId>;
  readonly project: ProjectName;
  /** Whether the children start listed as rows. */
  readonly expanded: boolean;
  /** Each child's want, when the page has it, for the listed rows. */
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
      {open ? (
        <ul
          className="border-rule mt-1 ml-[0.4375rem] flex flex-col border-l pl-3"
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
                stamp={stamps.has(ask)}
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
      ) : (
        <div hidden id={rowsId} />
      )}
    </div>
  );
};

/** One member in the vertical form: its mark, its name, its state's word; the member being read filled. */
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

/** The family read top to bottom: the parent, its children on a bus, then the delete child. */
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
  /** The member whose page this is. */
  readonly current?: AskId;
  readonly project: ProjectName;
}) => {
  const family = familyOf(parent, states, finale);
  const own = markOf(states.get(parent.id));

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
