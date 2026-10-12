import { Schema } from "effect";

export const checked = <T, E>(schema: Schema.Codec<T, E>) => {
  const decode = Schema.decodeSync(schema);
  const encode = Schema.encodeSync(schema);

  return (input: E): E => encode(decode(input));
};
