import { Reserve } from "@repo/protocol/domain/ask";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { KindName, ProjectName } from "@repo/protocol/ids";
import { Option, Schema } from "effect";

import { ASKS_PATH } from "../shared/paths.ts";

export const Take = Schema.Literal("open");

export type Take = typeof Take.Type;

export interface FrontFilter {
  readonly kind?: KindName;
  readonly reserved?: Reserve;
  readonly take?: Take;
  readonly project?: ProjectName;
}

export type FrontFilterInput = {
  readonly [Key in keyof FrontFilter]?: FrontFilter[Key] | undefined;
};

const decodeKind = Schema.decodeUnknownOption(KindName);

const decodeReserve = Schema.decodeUnknownOption(Reserve);

const decodeTake = Schema.decodeUnknownOption(Take);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const present = <A, B>(value: A | undefined, field: (a: A) => B) =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: () => ({}),
    onSome: field,
  });

export const compact = (input: FrontFilterInput): FrontFilter => ({
  ...present(input.kind, (kind) => ({ kind })),
  ...present(input.project, (project) => ({ project })),
  ...present(input.reserved, (reserved) => ({ reserved })),
  ...present(input.take, (take) => ({ take })),
});

/**
 * A value that does not decode is dropped, so a stale or mistyped link shows
 * the whole list rather than an error.
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

export const frontPath = (filter: FrontFilterInput) => {
  const search = new URLSearchParams(
    (["kind", "take", "reserved", "project"] as const).flatMap((key) => {
      const value = filter[key];

      return value === undefined ? [] : [[key, value]];
    })
  ).toString();

  return search === "" ? ASKS_PATH : `${ASKS_PATH}?${search}`;
};

export const passes = (filter: FrontFilter) => (entry: FrontPageEntry) =>
  (filter.kind === undefined || entry.ask.kind === filter.kind) &&
  (filter.reserved === undefined || entry.ask.reserve === filter.reserved) &&
  (filter.take === undefined || entry.takeable) &&
  (filter.project === undefined || entry.project === filter.project);

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

export const countWith = (
  entries: readonly FrontPageEntry[],
  filter: FrontFilter,
  part: FrontFilterInput
): number => entries.filter(passes(compact({ ...filter, ...part }))).length;
