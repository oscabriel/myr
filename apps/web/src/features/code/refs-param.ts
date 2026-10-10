/**
 * The refs page's `?package=`, decoded where the route reads it, in a
 * module with no view of its own.
 */
import { Schema } from "effect";

/** A `?package=` from the address, decoded; none for anything but a name. */
export const packageParamOf = Schema.decodeUnknownOption(
  Schema.NonEmptyString.check(Schema.isMaxLength(255))
);
