/**
 * The front page's filter, read from its address (`?kind=bug&reserved=newcomers`),
 * in a module with no view of its own: the route decodes its search with
 * it before the page's view loads.
 */
import { Reserve } from "@repo/protocol/domain/ask";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { KindName } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

/** What the front page is narrowed to: one kind, and asks held for someone. */
export interface FrontFilter {
  readonly kind?: KindName;
  readonly reserved?: Reserve;
}

const decodeKind = Schema.decodeUnknownOption(KindName);

const decodeReserve = Schema.decodeUnknownOption(Reserve);

/**
 * The filter in an address's search (`?kind=bug&reserved=newcomers`): each
 * value that decodes is kept, and one that does not is dropped, so a stale
 * or mistyped link shows the whole list rather than an error.
 */
export const readFilter = (search: {
  readonly kind?: unknown;
  readonly reserved?: unknown;
}): FrontFilter => ({
  ...Option.match(decodeKind(search.kind), {
    onNone: () => ({}),
    onSome: (kind) => ({ kind }),
  }),
  ...Option.match(decodeReserve(search.reserved), {
    onNone: () => ({}),
    onSome: (reserved) => ({ reserved }),
  }),
});

/** The front page's address for `filter`; a key set to `undefined` is no filter. */
export const frontPath = (filter: {
  readonly kind?: KindName | undefined;
  readonly reserved?: Reserve | undefined;
}) => {
  const search = new URLSearchParams([
    ...(filter.kind === undefined ? [] : [["kind", filter.kind]]),
    ...(filter.reserved === undefined ? [] : [["reserved", filter.reserved]]),
  ]).toString();

  return search === "" ? "/" : `/?${search}`;
};

/**
 * The entries `filter` keeps, the ones the viewer may take first; each group
 * keeps the order given (the platform's: newest ask first).
 */
export const filterEntries = (
  entries: readonly FrontPageEntry[],
  filter: FrontFilter
): readonly FrontPageEntry[] => {
  const kept = entries.filter(
    ({ ask }) =>
      (filter.kind === undefined || ask.kind === filter.kind) &&
      (filter.reserved === undefined || ask.reserve === filter.reserved)
  );

  return [
    ...kept.filter(({ takeable }) => takeable),
    ...kept.filter(({ takeable }) => !takeable),
  ];
};
