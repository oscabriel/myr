/**
 * The front page's filter, read from its address
 * (`?kind=bug&take=open&project=datekit`), in a module with no view of its
 * own: the route decodes its search with it before the page's view loads.
 */
import { Reserve } from "@repo/protocol/domain/ask";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { KindName, ProjectName } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { ASKS_PATH } from "../shared/paths.ts";

/** Asks the viewer may take now: the one value `?take=` has. */
export const Take = Schema.Literal("open");

export type Take = typeof Take.Type;

/**
 * What the front page is narrowed to: one kind; asks open to take, or held
 * for someone; one project.
 */
export interface FrontFilter {
  readonly kind?: KindName;
  readonly reserved?: Reserve;
  readonly take?: Take;
  readonly project?: ProjectName;
}

/** A filter as an address may write it: a key set to `undefined` is no filter. */
export type FrontFilterInput = {
  readonly [Key in keyof FrontFilter]?: FrontFilter[Key] | undefined;
};

const decodeKind = Schema.decodeUnknownOption(KindName);

const decodeReserve = Schema.decodeUnknownOption(Reserve);

const decodeTake = Schema.decodeUnknownOption(Take);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/** `{ [key]: value }` when there is a value, and nothing when there is none. */
const present = <A, B>(value: A | undefined, field: (a: A) => B) =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: () => ({}),
    onSome: field,
  });

/** `input` with every key left undefined dropped. */
export const compact = (input: FrontFilterInput): FrontFilter => ({
  ...present(input.kind, (kind) => ({ kind })),
  ...present(input.project, (project) => ({ project })),
  ...present(input.reserved, (reserved) => ({ reserved })),
  ...present(input.take, (take) => ({ take })),
});

/**
 * The filter in an address's search: each value that decodes is kept, and
 * one that does not is dropped, so a stale or mistyped link shows the whole
 * list rather than an error.
 */
export const readFilter = (search: {
  readonly kind?: unknown;
  readonly project?: unknown;
  readonly reserved?: unknown;
  readonly take?: unknown;
}): FrontFilter =>
  compact({
    kind: Option.getOrUndefined(decodeKind(search.kind)),
    project: Option.getOrUndefined(decodeProject(search.project)),
    reserved: Option.getOrUndefined(decodeReserve(search.reserved)),
    take: Option.getOrUndefined(decodeTake(search.take)),
  });

/** The front page's address for `filter`, in one key order. */
export const frontPath = (filter: FrontFilterInput) => {
  const search = new URLSearchParams(
    (["kind", "take", "reserved", "project"] as const).flatMap((key) => {
      const value = filter[key];

      return value === undefined ? [] : [[key, value]];
    })
  ).toString();

  return search === "" ? ASKS_PATH : `${ASKS_PATH}?${search}`;
};

/** Whether `entry` passes every part of `filter`. */
export const passes = (filter: FrontFilter) => (entry: FrontPageEntry) =>
  (filter.kind === undefined || entry.ask.kind === filter.kind) &&
  (filter.reserved === undefined || entry.ask.reserve === filter.reserved) &&
  (filter.take === undefined || entry.takeable) &&
  (filter.project === undefined || entry.project === filter.project);

/**
 * The entries `filter` keeps, the ones the viewer may take first; each group
 * keeps the order given (the platform's: newest ask first).
 */
export const filterEntries = (
  entries: readonly FrontPageEntry[],
  filter: FrontFilter
): readonly FrontPageEntry[] => {
  const shown = entries.filter(passes(filter));

  return [
    ...shown.filter(({ takeable }) => takeable),
    ...shown.filter(({ takeable }) => !takeable),
  ];
};

/**
 * How many entries `filter` would keep with `part` set as given and the
 * rest of the filter as it is: the count beside each filter option.
 */
export const countWith = (
  entries: readonly FrontPageEntry[],
  filter: FrontFilter,
  part: FrontFilterInput
): number => entries.filter(passes(compact({ ...filter, ...part }))).length;
