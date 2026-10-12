import { describe, expect, it } from "@effect/vitest";
import { EnvKey } from "@repo/protocol/ids";
import { Duration, Effect, Option, Redacted, Schema, Stream } from "effect";

import { scanBytes, scanStream, scanText } from "../src/leak-scan.ts";
import type { Watched } from "../src/leak-scan.ts";

const watched = (key: string, value: string): Watched => ({
  key: EnvKey.make(key),
  value: Redacted.make(value),
});

const found = (key: string) => Option.some(EnvKey.make(key));

const sentry = "sntrys_eyJpYXQiOjE3MjA";

const stripe = 'sk_live_51H"q/7+x Zr';

const values = [
  watched("SENTRY_AUTH_TOKEN", sentry),
  watched("STRIPE_KEY", stripe),
];

const utf8 = (text: string) => new TextEncoder().encode(text);

const base64 = Schema.encodeSync(Schema.StringFromBase64);

const base64Url = Schema.encodeSync(Schema.StringFromBase64Url);

const chunked = (text: string, cuts: readonly number[]) => {
  const bytes = utf8(text);
  const bounds = [0, ...cuts, bytes.length];

  return Stream.fromIterable(
    bounds.slice(1).map((end, index) => bytes.slice(bounds[index], end))
  );
};

describe("scanning text for stored values", () => {
  it("finds a value in plain text", () => {
    expect(
      scanText(`upload failed with token ${sentry}, retrying\n`, values)
    ).toStrictEqual(found("SENTRY_AUTH_TOKEN"));
  });

  it("finds nothing in text that holds no value", () => {
    expect(scanText("upload failed, retrying\n", values)).toStrictEqual(
      Option.none()
    );
  });

  it("finds a value JSON-escaped", () => {
    const text = JSON.stringify({ config: { token: stripe } });

    expect(text).toContain('sk_live_51H\\"q/7+x Zr');
    expect(text).not.toContain(stripe);
    expect(scanText(text, values)).toStrictEqual(found("STRIPE_KEY"));
  });

  it("finds a value URL-encoded, as a URI component or a form field", () => {
    const component = `https://api.example.invalid/v1?key=${encodeURIComponent(stripe)}`;
    const form = new URLSearchParams({ key: stripe }).toString();

    expect(component).not.toContain(stripe);
    expect(form).not.toContain(stripe);
    expect(scanText(component, values)).toStrictEqual(found("STRIPE_KEY"));
    expect(scanText(form, values)).toStrictEqual(found("STRIPE_KEY"));
  });

  it("finds a value base64-encoded, at any offset of a longer encoded text", () => {
    const encodings = ["", "u:", "us:", "use:"].flatMap((prefix) => [
      base64(`${prefix}${sentry}\n`),
      base64Url(`${prefix}${stripe}`),
    ]);

    expect(encodings.map((text) => scanText(text, values))).toStrictEqual(
      Array.from({ length: 4 }, () => [
        found("SENTRY_AUTH_TOKEN"),
        found("STRIPE_KEY"),
      ]).flat()
    );
    expect(
      scanText(`Authorization: Basic ${base64(`ci:${sentry}`)}`, values)
    ).toStrictEqual(found("SENTRY_AUTH_TOKEN"));
  });

  it("does not take a value's prefix for the value", () => {
    expect(
      scanText(`a token ${sentry.slice(0, -1)} that stops short`, values)
    ).toStrictEqual(Option.none());
  });

  it("never scans for a value under 3 characters, and scans for one of 3", () => {
    const pin = [watched("PIN", "ab")];
    const code = [watched("CODE", "abc")];

    expect(scanText("ab ab ab", pin)).toStrictEqual(Option.none());
    expect(scanBytes(utf8("ab ab ab"), pin)).toStrictEqual(Option.none());
    expect(scanText("xx abc xx", code)).toStrictEqual(found("CODE"));
  });

  it("names the first watched item that leaked, by its key alone", () => {
    expect(scanText(`${stripe} and ${sentry}`, values)).toStrictEqual(
      found("SENTRY_AUTH_TOKEN")
    );
  });

  it("finds a value in bytes, among bytes that are not text", () => {
    const bytes = new Uint8Array([0xff, 0x00, 0xc3, ...utf8(sentry), 0x80]);

    expect(scanBytes(bytes, values)).toStrictEqual(found("SENTRY_AUTH_TOKEN"));
    expect(scanBytes(new Uint8Array([0xff, 0x00, 0xc3]), values)).toStrictEqual(
      Option.none()
    );
  });

  it.live("scans 5 MB of text for 20 values in under a second", () =>
    Effect.gen(function* () {
      let state = 20_261_008;

      const draw = () => {
        state = (state * 48_271) % 2_147_483_647;

        return state.toString(36);
      };

      const many = Array.from({ length: 20 }, (_, index) =>
        watched(`KEY_${index}`, `sk_live_${draw()}${draw()}`)
      );

      const lines: string[] = [];
      let size = 0;

      while (size < 5_000_000) {
        const line = `GET /api/v1/items?page=${size} 200 sk_live_${draw()} ${draw()}\n`;

        lines.push(line);
        size += line.length;
      }

      const text = lines.join("");

      const [took, result] = yield* Effect.timed(
        Effect.sync(() => scanText(text, many))
      );

      expect(result).toStrictEqual(Option.none());
      expect(Duration.toMillis(took)).toBeLessThan(1000);
    })
  );
});

describe("scanning a stream for stored values", () => {
  const text = `log: deploying with ${sentry} now\n`;
  const start = utf8("log: deploying with ").length;

  it.effect("finds a value whole inside one chunk", () =>
    Effect.gen(function* () {
      expect(yield* scanStream(chunked(text, [2]), values)).toStrictEqual(
        found("SENTRY_AUTH_TOKEN")
      );
    })
  );

  it.effect("finds a value split across two chunks", () =>
    Effect.gen(function* () {
      expect(
        yield* scanStream(chunked(text, [start + 7]), values)
      ).toStrictEqual(found("SENTRY_AUTH_TOKEN"));
    })
  );

  it.effect("finds a value split across three chunks", () =>
    Effect.gen(function* () {
      expect(
        yield* scanStream(chunked(text, [start + 3, start + 12]), values)
      ).toStrictEqual(found("SENTRY_AUTH_TOKEN"));
    })
  );

  it.effect(
    "finds a value JSON-escaped or base64-encoded when the cut falls inside that form",
    () =>
      Effect.gen(function* () {
        // Each cut leaves an end that begins the encoded form but not the
        // value itself, so only a carry that knows the forms finds it.
        const json = JSON.stringify({ token: stripe });
        const encoded = `Basic ${base64(`ci:${sentry}`)}`;

        const hits = yield* Effect.forEach(
          [
            chunked(json, [json.indexOf("\\") + 1]),
            chunked(encoded, [encoded.length - 6]),
          ],
          (stream) => scanStream(stream, values)
        );

        expect(hits).toStrictEqual([
          found("STRIPE_KEY"),
          found("SENTRY_AUTH_TOKEN"),
        ]);
      })
  );

  it.effect("finds a value cut inside one of its multi-byte characters", () =>
    Effect.gen(function* () {
      const accented = "pässwörd-für-prod";
      const line = `secret=${accented};`;
      const at = utf8("secret=pä").length - 1;

      expect(
        yield* scanStream(chunked(line, [at]), [
          watched("DB_PASSWORD", accented),
        ])
      ).toStrictEqual(found("DB_PASSWORD"));
    })
  );

  it.effect(
    "does not take a prefix at a chunk's end for the value when the next chunk goes elsewhere",
    () =>
      Effect.gen(function* () {
        const prefix = sentry.slice(0, -1);

        expect(
          yield* scanStream(
            chunked(`a ${prefix}`, [2 + 5]).pipe(
              Stream.concat(Stream.make(utf8("? no")))
            ),
            values
          )
        ).toStrictEqual(Option.none());
      })
  );

  it.effect("finds nothing in a stream that holds no value", () =>
    Effect.gen(function* () {
      expect(
        yield* scanStream(chunked("nothing to see here\n", [3, 9]), values)
      ).toStrictEqual(Option.none());
    })
  );
});
