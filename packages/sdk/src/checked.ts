import { Schema } from "effect";

/**
 * Checks config data against its schema at the call and gives it back
 * encoded, so a mistake in the config folder fails where it is written,
 * with a Schema issue the rules evaluator can report.
 */
export const checked = <T, E>(schema: Schema.Codec<T, E>) => {
  const decode = Schema.decodeSync(schema);
  const encode = Schema.encodeSync(schema);

  return (input: E): E => encode(decode(input));
};
