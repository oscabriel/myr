/**
 * Which listed asks form a family, read from the names a migrate ask's split
 * gives its members: the platform opens a child per module as
 * `<parent>-<module>` and a delete child as `<parent>-delete`, and the
 * parent waits on all of them. A listing names no parent (the full ask does,
 * one read away), so a family is read from what the list holds: an ask that
 * waits on an ask named after it is a family's parent, and its members are
 * the listed asks it waits on, and its delete child.
 *
 * An ask that waits on another not named after it (one fix after another)
 * is no family: it stays a row of its own that reads as waiting.
 */
import type { AskListing } from "@repo/protocol/domain/ask";
import { AskId } from "@repo/protocol/ids";

/** One family, as a list holds it. */
export interface ListedFamily {
  readonly parent: AskId;
  /** Its members the list holds, in the list's order: the children still open, and the delete child. */
  readonly members: readonly AskId[];
  /** The delete child, which waits on every other child. */
  readonly finale: AskId;
}

/** The delete child a split gives `parent`. */
export const finaleOf = (parent: AskId): AskId =>
  AskId.make(`${parent}-delete`);

/** Whether `parent` waits on an ask named after it, as a split names its members. */
const isParent = ({ ask, blockedBy }: AskListing) =>
  blockedBy.some((blocker) => blocker.startsWith(`${ask}-`));

/** Every family among `listings`, each at its parent's place in the list. */
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

/** A list's item: an ask of its own, or a family drawn as one row. */
export type Arranged<L extends AskListing = AskListing> =
  | { readonly kind: "ask"; readonly listing: L }
  | {
      readonly kind: "family";
      readonly parent: L;
      readonly members: readonly L[];
      readonly finale: AskId;
    };

/**
 * `listings` as a list draws them: each family at its parent's place, its
 * members taken out of the list (they are drawn under the parent's fan),
 * every other ask where it was.
 */
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
