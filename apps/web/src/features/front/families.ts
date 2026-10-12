// A listing names no parent, so a family is read from names: a split opens
// `<parent>-<module>` children and a `<parent>-delete` child, and the parent
// waits on all of them.
import type { AskListing } from "@repo/protocol/domain/ask";
import { AskId } from "@repo/protocol/ids";

export interface ListedFamily {
  readonly parent: AskId;
  readonly members: readonly AskId[];
  readonly finale: AskId;
}

export const finaleOf = (parent: AskId): AskId =>
  AskId.make(`${parent}-delete`);

const isParent = ({ ask, blockedBy }: AskListing) =>
  blockedBy.some((blocker) => blocker.startsWith(`${ask}-`));

export const familiesIn = (
  listings: readonly AskListing[]
): readonly ListedFamily[] =>
  listings.flatMap((parent) => {
    if (!isParent(parent)) {
      return [];
    }

    const finale = finaleOf(parent.ask);
    const waits = new Set<string>([...parent.blockedBy, finale]);

    return [
      {
        finale,
        members: listings.flatMap(({ ask }) =>
          ask !== parent.ask && waits.has(ask) ? [ask] : []
        ),
        parent: parent.ask,
      },
    ];
  });

export type Arranged<L extends AskListing = AskListing> =
  | { readonly kind: "ask"; readonly listing: L }
  | {
      readonly kind: "family";
      readonly parent: L;
      readonly members: readonly L[];
      readonly finale: AskId;
    };

export const arrange = <L extends AskListing>(
  listings: readonly L[]
): readonly Arranged<L>[] => {
  const families = familiesIn(listings);
  const members = new Set(families.flatMap((family) => family.members));
  const byId = new Map(listings.map((listing) => [listing.ask, listing]));

  return listings.flatMap((listing): readonly Arranged<L>[] => {
    if (members.has(listing.ask)) {
      return [];
    }

    const family = families.find(({ parent }) => parent === listing.ask);

    return family === undefined
      ? [{ kind: "ask", listing }]
      : [
          {
            kind: "family",
            finale: family.finale,
            members: family.members.flatMap((member) => {
              const found = byId.get(member);

              return found === undefined ? [] : [found];
            }),
            parent: listing,
          },
        ];
  });
};

export const stillWaiting = <L extends AskListing>(listings: readonly L[]) => {
  const listed = new Set(listings.map(({ ask }) => ask));

  return listings.map((listing) => ({
    ...listing,
    blockedBy: listing.blockedBy.filter((blocker) => listed.has(blocker)),
  }));
};
