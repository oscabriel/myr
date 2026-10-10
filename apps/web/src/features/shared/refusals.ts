/**
 * A loader's 404 that carries the platform's refusal to the page, in a
 * module with no view of its own: a route's loader runs before its page's
 * view loads. The refusals travel in a not-found's data, encoded as
 * `Refusals`; the page decodes them where they arrive (AGENTS.md
 * principle 2).
 */
import { Refusal } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { Effect, Schema } from "effect";

/** Refusals as a not-found carries them. */
export const Refusals = Schema.NonEmptyArray(Refusal);

/** A loader's 404 for `refusal`: a not-found that carries it, encoded, to the page. */
export const notFoundFor = (refusal: Refusal) =>
  Effect.flatMap(Schema.encodeEffect(Refusals)([refusal]), (data) =>
    Effect.fail(notFound({ data }))
  );
