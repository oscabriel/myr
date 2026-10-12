import { Handle } from "@repo/protocol/ids";
import { Schema } from "effect";

export interface Vouch {
  readonly denounced: boolean;
  readonly handle: Handle;
  readonly note?: string;
  readonly platform?: string;
}

export interface InvalidVouchLine {
  readonly line: number;
  readonly text: string;
}

export interface VouchFile {
  readonly invalid: readonly InvalidVouchLine[];
  readonly vouches: readonly Vouch[];
}

// `-` denounces and `+` vouches explicitly (a second sample's spelling); the
// first word is the handle, with an optional `platform:` prefix; the rest of
// the line is a note.
const LINE =
  /^(?<sign>[+-]?)\s*(?:(?<platform>[a-z][a-z0-9-]*):)?(?<handle>\S+)(?:\s+(?<note>\S.*))?$/u;

const isHandle = Schema.is(Handle);

const vouchOf = (text: string): Vouch | undefined => {
  const groups = LINE.exec(text)?.groups;
  const handle = groups?.handle;

  if (groups === undefined || handle === undefined || !isHandle(handle)) {
    return undefined;
  }

  const vouch: Vouch = { denounced: groups.sign === "-", handle };

  const withNote: Vouch =
    groups.note === undefined ? vouch : { ...vouch, note: groups.note };

  return groups.platform === undefined
    ? withNote
    : { ...withNote, platform: groups.platform };
};

/** Ghostty's `VOUCHED.td` format; a line whose handle fails `Handle` is reported in `invalid`. */
export const parseVouchFile = (text: string): VouchFile => {
  const vouches: Vouch[] = [];
  const invalid: InvalidVouchLine[] = [];

  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const vouch = vouchOf(line);

    if (vouch === undefined) {
      invalid.push({ line: index + 1, text: line });
    } else {
      vouches.push(vouch);
    }
  }

  return { invalid, vouches };
};
