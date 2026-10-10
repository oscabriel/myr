/**
 * A project's open asks as rows: each ask its want first and its state at
 * the right, with its claim command when it is open; a family drawn as its
 * parent's row with the fan under it and its children listed, so a reader
 * sees how many of them landed and which wait.
 */
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import type { ReactNode } from "react";

import { arrange } from "../front/families.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import { FamilyStrip } from "../shared/family.tsx";
import { AskRow, RowList } from "../shared/row.tsx";

/** Whether an ask is open to take as its listing says: nobody holds it, it waits on nothing, and it is held for nobody. */
export const openToTake = (listing: AskListing) =>
  !listing.claimed &&
  listing.blockedBy.length === 0 &&
  listing.reserve === undefined;

/**
 * The asks a project counts as open: every one listed, but a family's
 * delete child while it waits on its siblings (it opens when they land).
 */
export const openAsks = (listings: readonly AskListing[]) => {
  const finales = new Set(
    arrange(listings).flatMap((item) =>
      item.kind === "family" ? [item.finale] : []
    )
  );

  return listings.filter(
    ({ ask, blockedBy }) => !(finales.has(ask) && blockedBy.length > 0)
  );
};

/** The project's asks, families as fans with their children listed. */
export const AskList = ({
  asks,
  onSelect,
  parents,
  project,
  selected,
  stamps,
  states,
}: {
  readonly asks: readonly AskListing[];
  readonly project: ProjectName;
  /** Each family's parent in full, which counts its children. */
  readonly parents: readonly Ask[];
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly stamps: ReadonlySet<AskId>;
  readonly selected: string | undefined;
  readonly onSelect: ((id: string) => void) | undefined;
}) => {
  const row = (listing: AskListing, strip?: ReactNode) => (
    <AskRow
      key={listing.ask}
      listing={listing}
      onSelect={onSelect}
      progress={states.get(listing.ask)}
      project={project}
      selected={selected === listing.ask}
      strip={strip}
    />
  );

  return (
    <RowList label="Open asks">
      {arrange(asks).flatMap((item) => {
        if (item.kind === "ask") {
          return [row(item.listing)];
        }

        const parent = parents.find(({ id }) => id === item.parent.ask);

        // A parent the platform did not give in full: its members stay rows.
        if (parent === undefined) {
          return [
            row(item.parent),
            ...item.members.map((member) => row(member)),
          ];
        }

        return [
          row(
            item.parent,
            <FamilyStrip
              expanded
              finale={item.finale}
              parent={parent}
              project={project}
              stamps={stamps}
              states={states}
              wants={
                new Map(item.members.map((member) => [member.ask, member.want]))
              }
            />
          ),
        ];
      })}
    </RowList>
  );
};

/** Row ids in the order `AskList` draws them: what `j` and `k` walk. */
export const askListIds = (asks: readonly AskListing[]) =>
  arrange(asks).map((item) =>
    item.kind === "ask" ? item.listing.ask : item.parent.ask
  );
