/**
 * A revision as one segment of a code page's path
 * (`/$project/tree/$rev/$`): `main`, a 40-hex commit SHA, or a tag name.
 * A tag name may hold `/` and `@` (`@changesets/cli@2.27.1`), so it is
 * URL-encoded into one segment; `main` and a SHA encode to themselves.
 * Whether a revision names anything is the platform's to say (`readTree`
 * and the other code reads refuse with `UnknownRevision`).
 */
import { Rev } from "@repo/protocol/domain/code";
import { Option, Schema } from "effect";

/** `rev` as one path segment. */
export const revSegment = (rev: string): string => encodeURIComponent(rev);

const decodeSegment = Option.liftThrowable(decodeURIComponent);

const asRev = Schema.decodeUnknownOption(Rev);

/**
 * The revision a path segment names: none for a segment that is not a
 * valid encoding (`%`) or not a revision at all (empty, too long). A
 * segment the router already decoded reads as itself.
 */
export const revOf = (segment: string): Option.Option<string> =>
  Option.flatMap(decodeSegment(segment), asRev);

/** The revision a page reads, beside its title: a commit by its short id. */
export const revLabel = (rev: string) =>
  /^[0-9a-f]{40}$/u.test(rev) ? rev.slice(0, 7) : rev;
