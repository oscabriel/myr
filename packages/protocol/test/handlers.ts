import { Effect } from "effect";

import { Contracts, EnvSchemaOf } from "../src/contracts.ts";

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
