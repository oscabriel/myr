import { Schema } from "effect";
import type { Array } from "effect";

import { Refusal } from "./refusal.ts";

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
