/**
 * Just enough JSONC for `wrangler.jsonc`: read it as JSON, and find where
 * each value sits so one value can be rewritten in place, leaving every
 * comment, comma and line as it was.
 */

/** A value's place in the text: `[start, end)`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A path into a JSON value: object keys and array indexes. */
export type JsonPath = readonly (string | number)[];

/** One key for a path, for a `Map`. */
export const pathKey = (path: JsonPath) => JSON.stringify(path);

const blankRange = (chars: string[], from: number, to: number) => {
  for (let at = from; at < to; at += 1) {
    if (chars[at] !== "\n") {
      chars[at] = " ";
    }
  }
};

/** The offset just past the string literal that opens at `start`. */
const stringEnd = (text: string, start: number) => {
  let at = start + 1;

  while (at < text.length && text[at] !== '"') {
    at += text[at] === "\\" ? 2 : 1;
  }

  return at + 1;
};

/** Where the comment at `at` ends, or `at` when none starts there. */
const commentEnd = (text: string, at: number) => {
  if (text.startsWith("//", at)) {
    const end = text.indexOf("\n", at);

    return end === -1 ? text.length : end;
  }

  if (text.startsWith("/*", at)) {
    const end = text.indexOf("*/", at + 2);

    return end === -1 ? text.length : end + 2;
  }

  return at;
};

/** Whether only whitespace stands between `at` and a closing bracket. */
const closesNext = (text: string, at: number) =>
  /^\s*[\]}]/u.test(text.slice(at + 1));

/**
 * `text` with every comment and trailing comma turned to spaces: plain JSON
 * whose offsets are the original's.
 */
export const blankJsonc = (text: string): string => {
  // UTF-16 units, so every offset is a `slice` offset.
  const chars = text.split("");
  let at = 0;

  while (at < text.length) {
    const end = commentEnd(text, at);

    if (text[at] === '"') {
      at = stringEnd(text, at);
    } else if (end > at) {
      blankRange(chars, at, end);
      at = end;
    } else {
      at += 1;
    }
  }

  // Commas only after the comments are gone, so `x, // note\n}` is seen.
  const blanked = chars.join("");

  at = 0;

  while (at < blanked.length) {
    if (blanked[at] === '"') {
      at = stringEnd(blanked, at);
    } else {
      if (blanked[at] === "," && closesNext(blanked, at)) {
        chars[at] = " ";
      }

      at += 1;
    }
  }

  return chars.join("");
};

/** A cursor over plain JSON that records each value's span by its path. */
interface Reader {
  readonly json: string;
  readonly spans: Map<string, Span>;
  at: number;
}

const skipSpace = (reader: Reader) => {
  while (/\s/u.test(reader.json[reader.at] ?? "")) {
    reader.at += 1;
  }
};

const readString = (reader: Reader) => {
  const start = reader.at;

  reader.at = stringEnd(reader.json, start);

  return reader.json.slice(start, reader.at);
};

/** Reads the members of an object or array, after its opening bracket. */
const readMembers = (
  reader: Reader,
  close: "}" | "]",
  readOne: (index: number) => void
) => {
  reader.at += 1;
  skipSpace(reader);

  for (let index = 0; reader.json[reader.at] !== close; index += 1) {
    readOne(index);
    skipSpace(reader);

    if (reader.json[reader.at] === ",") {
      reader.at += 1;
      skipSpace(reader);
    }
  }

  reader.at += 1;
};

const readValue = (reader: Reader, path: JsonPath): void => {
  skipSpace(reader);

  const start = reader.at;
  const opening = reader.json[start];

  if (opening === "{") {
    readMembers(reader, "}", () => {
      const key: unknown = JSON.parse(readString(reader));

      skipSpace(reader);
      reader.at += 1;
      readValue(reader, [...path, String(key)]);
    });
  } else if (opening === "[") {
    readMembers(reader, "]", (index) => {
      readValue(reader, [...path, index]);
    });
  } else if (opening === '"') {
    readString(reader);
  } else {
    while (!/[\s,\]}]/u.test(reader.json[reader.at] ?? ",")) {
      reader.at += 1;
    }
  }

  reader.spans.set(pathKey(path), { end: reader.at, start });
};

/** Where every value in `json` (plain JSON, as `blankJsonc` makes it) sits, by path. */
export const valueSpans = (json: string): ReadonlyMap<string, Span> => {
  const reader: Reader = { at: 0, json, spans: new Map() };

  readValue(reader, []);

  return reader.spans;
};
