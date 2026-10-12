import { Rev } from "@repo/protocol/domain/code";
import { Option, Schema } from "effect";

/** A tag name may hold `/` and `@`, so it is encoded into one segment. */
export const revSegment = (rev: string): string => encodeURIComponent(rev);

const decodeSegment = Option.liftThrowable(decodeURIComponent);

const asRev = Schema.decodeUnknownOption(Rev);

/** A segment the router already decoded reads as itself. */
export const revOf = (segment: string): Option.Option<string> =>
  Option.flatMap(decodeSegment(segment), asRev);

export const revLabel = (rev: string) =>
  /^[0-9a-f]{40}$/u.test(rev) ? rev.slice(0, 7) : rev;
