import { Schema } from "effect";

export const packageParamOf = Schema.decodeUnknownOption(
  Schema.NonEmptyString.check(Schema.isMaxLength(255))
);
