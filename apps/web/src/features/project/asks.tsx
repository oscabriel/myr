import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { arrange } from "../front/families.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import { FamilyStrip } from "../shared/family.tsx";
import { AskRow, RowList } from "../shared/row.tsx";

export const openToTake = (listing: AskListing) =>
  !listing.claimed &&
  listing.blockedBy.length === 0 &&
  listing.reserve === undefined;

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

export const AskList = ({
  asks,
  now,
  parents,
  project,
  selected,
  stamps,
  states,
}: {
  readonly asks: readonly AskListing[];
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly parents: readonly Ask[];
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly stamps: ReadonlySet<AskId>;
  readonly selected: string | undefined;
}) => {
  const row = (listing: AskListing, strip?: ReactNode) => (
    <AskRow
      key={listing.ask}
      listing={listing}
      now={now}
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

export const askListIds = (asks: readonly AskListing[]) =>
  arrange(asks).map((item) =>
    item.kind === "ask" ? item.listing.ask : item.parent.ask
  );
