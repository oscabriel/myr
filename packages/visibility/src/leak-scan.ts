// Ported from dmno-dev/varlock@928e8e4b `packages/varlock/src/runtime/env.ts`
// l.55–76 (each sensitive value registered with its serialized form),
// l.109–133 (`getRedactionHoldbackLength`: what a chunk holds back for the
// next) and l.349–433 (`scanForLeaks`: exact substring match on every value,
// and its stream branch, which scans each chunk with the previous one's tail
// prepended). Ours to change since: no global redaction state, no console
// and no throw; the values come in as an argument, the answer is the leaked
// item's key, and each value is also looked for JSON-escaped, URL-encoded
// and base64-encoded at every byte offset. varlock's licence travels with
// the technique it lent:
//
// MIT License
//
// Copyright (c) 2026 DMNO Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * The leak scan (VL §8.6; OSR §5.3 step 7): whether a text, some bytes or
 * a stream holds a stored value, by exact match. It answers with the item's
 * key alone, never where the value was or what it was, so its answer cannot
 * help anyone guess a value. Values under `HARD_MIN_LENGTH` characters are
 * never looked for: they would match ordinary text everywhere.
 */
import type { EnvKey } from "@repo/protocol/ids";
import { Option, Redacted, Schema, Stream } from "effect";
import type { Effect } from "effect";

import { charactersIn, HARD_MIN_LENGTH } from "./vault.ts";

/** A stored value to look for, and the item it belongs to. */
export interface Watched {
  readonly key: EnvKey;
  readonly value: Redacted.Redacted;
}

/** One watched item and every form of its value the scan looks for. */
interface Needle {
  readonly forms: readonly string[];
  readonly key: EnvKey;
}

/** Every value's forms, in the order the items were given, and the longest form. */
interface Needles {
  readonly longest: number;
  readonly needles: readonly Needle[];
}

/**
 * The shortest base64 run looked for: 48 bits, so text that only happens
 * to be base64 matches one by chance about once in 2^48 positions. A
 * shorter value is still looked for as itself.
 */
const ENCODED_MIN = 8;

const encodeBase64 = Schema.encodeSync(Schema.Uint8ArrayFromBase64);

/**
 * The value's bytes as they read inside any longer base64 text: encoded at
 * each of the three byte offsets, less the characters its neighbours share,
 * in both alphabets (`+/` and `-_`).
 */
const base64Forms = (value: string) => {
  const bytes = new TextEncoder().encode(value);

  return [0, 1, 2].flatMap((offset) => {
    const shifted = new Uint8Array(offset + bytes.length);

    shifted.set(bytes, offset);

    const run = encodeBase64(shifted).slice(
      Math.ceil((offset * 8) / 6),
      Math.floor(((offset + bytes.length) * 8) / 6)
    );

    return run.length < ENCODED_MIN
      ? []
      : [run, run.replaceAll("+", "-").replaceAll("/", "_")];
  });
};

/**
 * Every form a value takes where it commonly leaks: as itself, inside a
 * JSON string, URL-encoded as a URI component or a form field, and inside
 * base64 text. Each form once.
 */
const formsOf = (value: string) => [
  ...new Set([
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    new URLSearchParams([["", value]]).toString().slice(1),
    ...base64Forms(value),
  ]),
];

/** The forms of every value long enough to look for. */
const needlesOf = (values: readonly Watched[]): Needles => {
  const needles = values.flatMap(({ key, value }) => {
    const text = Redacted.value(value);

    return charactersIn(text) < HARD_MIN_LENGTH
      ? []
      : [{ forms: formsOf(text), key }];
  });

  return {
    longest: Math.max(
      0,
      ...needles.flatMap(({ forms }) => forms.map((form) => form.length))
    ),
    needles,
  };
};

/** The first watched item any form of whose value `text` contains. */
const firstLeak = (text: string, { needles }: Needles) =>
  Option.fromUndefinedOr(
    needles.find(({ forms }) => forms.some((form) => text.includes(form)))
  ).pipe(Option.map(({ key }) => key));

/**
 * The length of the longest end of `text` that some form starts with, short
 * of a whole form (a whole one is found where it is): what a chunk carries
 * into the next so a value split between them is still found.
 */
const holdback = (text: string, { longest, needles }: Needles) => {
  for (
    let length = Math.min(text.length, longest - 1);
    length > 0;
    length -= 1
  ) {
    const end = text.slice(text.length - length);

    if (
      needles.some(({ forms }) =>
        forms.some((form) => form.length > length && form.startsWith(end))
      )
    ) {
      return length;
    }
  }

  return 0;
};

/** The item whose stored value `text` holds, in any of its forms; none when it holds none. */
export const scanText = (
  text: string,
  values: readonly Watched[]
): Option.Option<EnvKey> => firstLeak(text, needlesOf(values));

/** As `scanText`, over bytes read as UTF-8 (bytes that are not text match nothing). */
export const scanBytes = (
  bytes: Uint8Array,
  values: readonly Watched[]
): Option.Option<EnvKey> => scanText(new TextDecoder().decode(bytes), values);

/**
 * As `scanText`, over a stream of byte chunks, read as UTF-8 in order. Each
 * chunk is scanned with the end of the text before it that could begin a
 * value, so a value split across any number of chunks is found. Stops at
 * the first leak.
 */
export const scanStream = <E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  values: readonly Watched[]
): Effect.Effect<Option.Option<EnvKey>, E, R> => {
  const needles = needlesOf(values);

  return stream.pipe(
    Stream.decodeText(),
    Stream.mapAccum(
      () => "",
      (carry, chunk) => {
        const text = carry + chunk;

        return [
          text.slice(text.length - holdback(text, needles)),
          Option.toArray(firstLeak(text, needles)),
        ] as const;
      }
    ),
    Stream.runHead
  );
};
