/**
 * Server sides for tests. Test code alone imports this module: other
 * workspaces through `@repo/protocol/testing`, protocol's own tests by
 * relative path. Nothing under any `src/` may.
 */
import { Effect, Layer } from "effect";

import { Contracts, EnvSchemaOf } from "./contracts.ts";
import { Handle } from "./ids.ts";
import { Authenticated, CurrentPrincipal, Person } from "./principal.ts";

/** A server side that takes every call as `handle`, for tests with several people. */
export const asPerson = (handle: Handle): Layer.Layer<Authenticated> =>
  Layer.succeed(Authenticated, (effect) =>
    Effect.provideService(effect, CurrentPrincipal, Person.make({ handle }))
  );

/** A server side that takes every call as one person, for tests about other things. */
export const asTester: Layer.Layer<Authenticated> = asPerson(
  Handle.make("tester")
);

/** What a contract does when a test reaches one it did not set up. */
const uncalled = () =>
  Effect.die("This test calls only the contracts it sets up.");

/**
 * A handler for every contract, none of which a test should reach. A test
 * merges the ones it is about over these, each with
 * `Contracts.toLayerHandler`: a later layer's handler wins.
 */
export const unanswered = Contracts.toLayer({
  claim: uncalled,
  credits: uncalled,
  decide: uncalled,
  // Keyed by the class: lint keeps "shape" out of code names.
  [EnvSchemaOf._tag]: uncalled,
  evidence: uncalled,
  finish: uncalled,
  flagAsk: uncalled,
  fork: uncalled,
  frontPage: uncalled,
  initProject: uncalled,
  land: uncalled,
  landing: uncalled,
  ledger: uncalled,
  listAsks: uncalled,
  listProjects: uncalled,
  openAsk: uncalled,
  proposeAsk: uncalled,
  release: uncalled,
  setEnv: uncalled,
  showAsk: uncalled,
  status: uncalled,
  submitAnswer: uncalled,
  today: uncalled,
  verdict: uncalled,
  vouch: uncalled,
  watch: uncalled,
});
