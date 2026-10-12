import { CheckSpec } from "@repo/protocol/domain/check";
import type { RatchetSpec } from "@repo/protocol/domain/check";
import { Command } from "@repo/protocol/domain/common";
import type { CheckKind } from "@repo/protocol/domain/kind";
import type { RunBlock } from "@repo/protocol/domain/run";
import { CheckVersion, LaneName } from "@repo/protocol/ids";
import { Option, Predicate } from "effect";
import type { Schema } from "effect";

export const PATH_PLACEHOLDER = "{path}";

export const checkKindOf = (spec: CheckSpec): CheckKind =>
  CheckSpec.match(spec, {
    LintToZero: (): CheckKind => "lintToZero",
    Migrate: (): CheckKind => "migrate",
    Ratchet: (): CheckKind => "ratchet",
    RedThenGreen: (): CheckKind => "redThenGreen",
    SymbolAbsent: (): CheckKind => "symbolAbsent",
  });

const shellWord = (path: string) =>
  /^[\w./@+-]+$/u.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;

const declared = (
  ratchets: readonly RatchetSpec[],
  name: string
): Option.Option<RatchetSpec> =>
  Option.fromNullishOr(ratchets.find((ratchet) => ratchet.name === name));

export const commandFor = (
  spec: CheckSpec,
  run: RunBlock,
  ratchets: readonly RatchetSpec[] = []
): Option.Option<{ readonly command: Command; readonly lane: LaneName }> =>
  CheckSpec.match(spec, {
    LintToZero: ({ command }) => Option.some(command),
    Migrate: ({ count }) => Option.some(count),
    Ratchet: ({ ratchet }) =>
      Option.map(declared(ratchets, ratchet), ({ measure }) => measure.command),
    RedThenGreen: ({ path }) =>
      run.test.includes(PATH_PLACEHOLDER)
        ? Option.some(
            Command.make(run.test.replaceAll(PATH_PLACEHOLDER, shellWord(path)))
          )
        : Option.none(),
    SymbolAbsent: ({ count }) => Option.some(count),
  }).pipe(
    Option.map((command) => ({
      command,
      lane: LaneName.make(checkKindOf(spec)),
    }))
  );

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

// JSON with every object's keys sorted, so equal data hashes equally.
const canonicalJson = (value: Schema.Json): string => {
  if (isJsonArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (isJsonObject(value)) {
    const entries = Object.keys(value)
      .toSorted()
      .flatMap((key) => {
        const field = value[key];

        return field === undefined
          ? []
          : [`${JSON.stringify(key)}:${canonicalJson(field)}`];
      });

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
};

// UTF-8 bytes of a string, without the DOM's TextEncoder: percent-encoding
// writes each byte that isn't a plain ASCII character as `%XX`. The text is
// JSON.stringify's, which never holds a lone surrogate.
const utf8 = (text: string): readonly number[] => {
  const encoded = encodeURIComponent(text);
  const bytes: number[] = [];

  for (let at = 0; at < encoded.length; at += 1) {
    if (encoded[at] === "%") {
      bytes.push(Number.parseInt(encoded.slice(at + 1, at + 3), 16));
      at += 2;
    } else {
      bytes.push(encoded.codePointAt(at) ?? 0);
    }
  }

  return bytes;
};

const FNV_OFFSET = 0xcb_f2_9c_e4_84_22_23_25n;

const FNV_PRIME = 0x1_00_00_00_01_b3n;

const TWO_TO_64 = 2n ** 64n;

// `hash ^ byte`: only the low byte changes, so XOR it bit by bit. Plain
// arithmetic, since the lint config refuses bitwise operators.
const xorLowByte = (hash: bigint, byte: number): bigint => {
  const low = Number(hash % 256n);
  let mixed = 0;

  for (let bit = 1; bit < 256; bit *= 2) {
    if (Math.floor(low / bit) % 2 !== Math.floor(byte / bit) % 2) {
      mixed += bit;
    }
  }

  return hash - BigInt(low) + BigInt(mixed);
};

// FNV-1a, 64-bit, as 16 hex digits. A cache key, not a commitment, so it
// needs no WebCrypto and stays synchronous.
const fnv1a64 = (text: string) => {
  let hash = FNV_OFFSET;

  for (const byte of utf8(text)) {
    hash = (xorLowByte(hash, byte) * FNV_PRIME) % TWO_TO_64;
  }

  return hash.toString(16).padStart(16, "0");
};

// The run hash covers everything the run executes and nothing else; `doctor`
// judges nothing, so it is left out.
export const checkVersion = (
  spec: CheckSpec,
  sdkVersion: string,
  run: RunBlock,
  ratchets: readonly RatchetSpec[] = []
): CheckVersion => {
  const runs: Schema.Json = {
    check: spec,
    checks: run.checks,
    command: Option.getOrNull(
      Option.map(commandFor(spec, run, ratchets), ({ command }) => command)
    ),
    image: run.image ?? null,
    measure: CheckSpec.guards.Ratchet(spec)
      ? Option.getOrNull(
          Option.map(declared(ratchets, spec.ratchet), ({ measure }) => measure)
        )
      : null,
    setup: run.setup ?? null,
    setupEgress: run.setupEgress ?? null,
  };

  return CheckVersion.make(
    `${checkKindOf(spec)}@${sdkVersion}+${fnv1a64(canonicalJson(runs))}`
  );
};
