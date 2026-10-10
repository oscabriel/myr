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

/** Lines on one side of one file's diff: the new side unless `deletions`. */
export interface DiffLines extends LineRange {
  readonly path: string;
  readonly side: "additions" | "deletions";
}

const DIFF_ANCHOR =
  /^#?diff-(?<path>[^:]+)(?::(?<lines>[DL]\d+(?:-[DL]\d+)?))?$/u;

const decodePath = Option.liftThrowable(decodeURIComponent);

/**
 * The file a commit page's hash names (`#diff-src%2Fparse.ts`), and its
 * lines when it names some (`…:L4-L7` on the new side, `…:D4` on the old).
 */
export const parseDiffHash = (
  hash: string
): Option.Option<{
  readonly path: string;
  readonly lines: Option.Option<DiffLines>;
}> => {
  const groups = DIFF_ANCHOR.exec(hash)?.groups;

  return Option.flatMap(Option.fromUndefinedOr(groups?.path), (encoded) =>
    Option.map(decodePath(encoded), (path) => ({
      lines: Option.map(
        Option.flatMap(Option.fromUndefinedOr(groups?.lines), (lines) =>
          parseLineHash(lines.replaceAll("D", "L"))
        ),
        (range): DiffLines => ({
          ...range,
          path,
          side:
            groups?.lines?.startsWith("D") === true ? "deletions" : "additions",
        })
      ),
      path,
    }))
  );
};

/** The hash naming `lines` of a file's diff, without the `#`. */
export const diffLinesHash = ({
  end,
  path,
  side,
  start,
}: DiffLines): string => {
  const mark = side === "deletions" ? "D" : "L";

  const lines =
    start === end ? `${mark}${start}` : `${mark}${start}-${mark}${end}`;

  return `diff-${encodeURIComponent(path)}:${lines}`;
};
