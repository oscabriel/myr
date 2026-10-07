import { Schema } from "effect";
import type { Array } from "effect";

import { Refusal } from "./refusal.ts";

/**
 * The one shape of every CLI command's `--json` output: the command's result,
 * or the refusals it met instead, under a version a script can check.
 */
export const Envelope = <A extends Schema.Top>(data: A) =>
  Schema.Union([
    Schema.Struct({
      command: Schema.NonEmptyString,
      data,
      ok: Schema.Literal(true),
      v: Schema.Literal(1),
    }),
    Schema.Struct({
      command: Schema.NonEmptyString,
      ok: Schema.Literal(false),
      refusals: Schema.NonEmptyArray(Refusal),
      v: Schema.Literal(1),
    }),
  ]);

/** A command's `--json` output whose result is an `A`. */
export type Envelope<A> =
  | {
      readonly command: string;
      readonly data: A;
      readonly ok: true;
      readonly v: 1;
    }
  | {
      readonly command: string;
      readonly ok: false;
      readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
      readonly v: 1;
    };
