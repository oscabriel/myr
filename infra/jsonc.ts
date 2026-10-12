// Just enough JSONC to rewrite one `wrangler.jsonc` value in place, leaving
// every comment, comma and line as it was.

export interface Span {
  readonly start: number;
  readonly end: number;
}

export type JsonPath = readonly (string | number)[];

export const pathKey = (path: JsonPath) => JSON.stringify(path);

const blankRange = (chars: string[], from: number, to: number) => {
  for (let at = from; at < to; at += 1) {
    if (chars[at] !== "\n") {
      chars[at] = " ";
    }
  }
};

const stringEnd = (text: string, start: number) => {
  let at = start + 1;

  while (at < text.length && text[at] !== '"') {
    at += text[at] === "\\" ? 2 : 1;
  }

  return at + 1;
};

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

const closesNext = (text: string, at: number) =>
  /^\s*[\]}]/u.test(text.slice(at + 1));

// Comments and trailing commas become spaces, so offsets stay the original's.
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

export const valueSpans = (json: string): ReadonlyMap<string, Span> => {
  const reader: Reader = { at: 0, json, spans: new Map() };

  readValue(reader, []);

  return reader.spans;
};
