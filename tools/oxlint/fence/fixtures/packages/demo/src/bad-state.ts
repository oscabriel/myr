import { Effect } from "effect";

let requests = 0;

{
  var hits = 0;
}

export const count = Effect.sync(() => {
  requests += 1;
  hits += 1;
  return requests + hits;
});
