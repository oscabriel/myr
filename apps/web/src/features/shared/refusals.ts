import { Refusal } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { Effect, Schema } from "effect";

export const Refusals = Schema.NonEmptyArray(Refusal);

export const notFoundFor = (refusal: Refusal) =>
  Effect.flatMap(Schema.encodeEffect(Refusals)([refusal]), (data) =>
    Effect.fail(notFound({ data }))
  );
