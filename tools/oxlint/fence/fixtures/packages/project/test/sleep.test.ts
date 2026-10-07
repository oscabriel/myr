import { it } from "@effect/vitest";
import { Effect } from "effect";

// Tests may wait: the rule guards the package's runtime source only.
it.effect("waits", () => Effect.sleep("1 second"));
