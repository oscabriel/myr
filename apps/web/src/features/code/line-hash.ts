/**
 * Line anchors on a file page: `#L10` names line 10 and `#L10-L20` lines
 * 10 to 20 (either end may come first). Lines count from 1, as git and
 * Pierre's `SelectedLineRange` do. Pure, so the file, why and propose pages
 * read and write anchors one way.
 */
import { Option } from "effect";

/** Lines `start` to `end`, both included, `start <= end`. */
export interface LineRange {
  readonly end: number;
  readonly start: number;
}

/** `L<n>` or `L<a>-L<b>`, with or without the `#` (the router's `hash` has none); no leading zero. */
const ANCHOR = /^#?L(?<first>[1-9]\d*)(?:-L(?<second>[1-9]\d*))?$/u;

/** The lines `hash` names, or none when it names no line. */
export const parseLineHash = (hash: string): Option.Option<LineRange> => {
  const groups = ANCHOR.exec(hash)?.groups;

  if (groups?.first === undefined) {
    return Option.none();
  }

  const first = Number(groups.first);
  const second = groups.second === undefined ? first : Number(groups.second);

  return Option.some({
    end: Math.max(first, second),
    start: Math.min(first, second),
  });
};

/** The anchor for `range`: `#L<n>` for one line, `#L<a>-L<b>` for more. */
export const lineHash = ({ end, start }: LineRange): string =>
  start === end ? `#L${start}` : `#L${start}-L${end}`;
