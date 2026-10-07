import { Effect } from "effect";

// Outside packages/project, sleeping is someone else's business.
export const waits = Effect.sleep("1 second");
