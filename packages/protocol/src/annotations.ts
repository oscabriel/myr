import { Context } from "effect";

/** What a contract does, in one sentence, for every surface that lists it. */
export const Description = Context.Reference<string>("protocol/Description", {
  defaultValue: () => "",
});
