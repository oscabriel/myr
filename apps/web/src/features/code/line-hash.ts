import { Option } from "effect";

export interface LineRange {
  readonly end: number;
  readonly start: number;
}

const ANCHOR = /^#?L(?<first>[1-9]\d*)(?:-L(?<second>[1-9]\d*))?$/u;

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

export const lineHash = ({ end, start }: LineRange): string =>
  start === end ? `#L${start}` : `#L${start}-L${end}`;

export interface DiffLines extends LineRange {
  readonly path: string;
  readonly side: "additions" | "deletions";
}

const DIFF_ANCHOR =
  /^#?diff-(?<path>[^:]+)(?::(?<lines>[DL]\d+(?:-[DL]\d+)?))?$/u;

const decodePath = Option.liftThrowable(decodeURIComponent);

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
