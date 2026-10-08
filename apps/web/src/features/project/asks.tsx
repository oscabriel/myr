/**
 * The pieces an ask's row repeats wherever asks are listed (a project's
 * page, the front page): where it stands, said with a mark and a word, and
 * its kind and territory as fields. An ask waiting on others is blocked,
 * which is waiting, never refusing: the asks it waits on are links, so a
 * reader can go and land them.
 */
import type { AskListing, Reserve } from "@repo/protocol/domain/ask";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import {
  Circle,
  Hand,
  Hourglass,
  LockKeyhole,
  Sprout,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";
import type { ReactNode } from "react";

/** A project's page. */
export const projectPath = (project: ProjectName) => `/${project}`;

/** An ask's page (issue 512's route). */
export const askPath = (project: ProjectName, ask: AskId) =>
  `/${project}/asks/${ask}`;

/** The mono face for names a terminal prints: ids, kinds, territories. */
export const ID = "font-mono text-[0.8125rem]";

/** Who a reserved ask is held for, in the words of the ask's page. */
const heldFor = {
  newcomers: { icon: Sprout, words: "Held for newcomers" },
  people: { icon: Hand, words: "Held for people, not agents" },
} as const satisfies Record<
  Reserve,
  { readonly icon: LucideIcon; readonly words: string }
>;

const Line = ({
  children,
  icon: Icon,
  tone,
}: {
  readonly children: ReactNode;
  readonly icon: LucideIcon;
  /** The role colour of the mark and word, as a text class. */
  readonly tone: string;
}) => (
  <li className={`flex items-start gap-1.5 ${tone}`}>
    <Icon aria-hidden="true" className="mt-[0.2rem] size-3.5 shrink-0" />
    <span className="min-w-0">{children}</span>
  </li>
);

/** What goes before the ask at `index` of `count` in "a, b and c". */
const separator = (index: number, count: number) => {
  if (index === 0) {
    return "";
  }

  return index === count - 1 ? " and " : ", ";
};

/** The asks `blockedBy` names, each a link, as "a, b and c". */
const Waits = ({
  asks,
  project,
}: {
  readonly asks: readonly AskId[];
  readonly project: ProjectName;
}) =>
  asks.map((ask, index) => (
    <Fragment key={ask}>
      {separator(index, asks.length)}
      <a
        className={`${ID} decoration-rule underline hover:decoration-current`}
        href={askPath(project, ask)}
      >
        {ask}
      </a>
    </Fragment>
  ));

/**
 * Where an ask stands for its reader. With `takeable` (the front page, which
 * knows the viewer), an ask they may take reads "Open to take" and one they
 * may not gives each reason it is not theirs: claimed, blocked, held for
 * someone, or, when none of those applies, their vouch or record. Without
 * it (a project's page), an ask reads open when nothing holds it.
 */
export const AskStanding = ({
  listing,
  project,
  takeable,
}: {
  readonly listing: AskListing;
  readonly project: ProjectName;
  readonly takeable?: boolean;
}) => {
  const held =
    listing.reserve === undefined ? undefined : heldFor[listing.reserve];

  const reasons = [
    listing.claimed ? (
      <Line icon={UserRound} key="claimed" tone="text-muted-foreground">
        Claimed
      </Line>
    ) : null,
    listing.blockedBy.length === 0 ? null : (
      <Line icon={Hourglass} key="blocked" tone="text-waiting">
        <strong className="font-semibold">Blocked</strong> until{" "}
        <span className="text-foreground">
          <Waits asks={listing.blockedBy} project={project} />
        </span>{" "}
        {listing.blockedBy.length === 1 ? "lands" : "land"}
      </Line>
    ),
  ].filter((line) => line !== null);

  const open = takeable ?? (reasons.length === 0 && held === undefined);

  const holder =
    held === undefined ? null : (
      <Line icon={held.icon} key="held" tone="text-muted-foreground">
        {held.words}
      </Line>
    );

  const lines = open
    ? [
        <Line icon={Circle} key="open" tone="text-foreground font-medium">
          Open to take
        </Line>,
        holder,
      ]
    : [...reasons, holder];

  const shown = lines.filter((line) => line !== null);

  return (
    <ul className="flex flex-col gap-0.5 text-sm" data-standing="">
      {shown.length > 0 ? (
        shown
      ) : (
        <Line icon={LockKeyhole} tone="text-muted-foreground">
          Not open to you yet: it needs a vouch or a record in its area
        </Line>
      )}
    </ul>
  );
};

/** An ask's kind and territory, as labelled fields. */
export const AskFields = ({ listing }: { readonly listing: AskListing }) => (
  <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground text-xs font-medium">Kind</dt>
      <dd className={ID}>{listing.kind}</dd>
    </div>
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-muted-foreground text-xs font-medium">Territory</dt>
      <dd className={`${ID} [overflow-wrap:anywhere]`}>{listing.territory}</dd>
    </div>
  </dl>
);
