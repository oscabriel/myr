// Test code alone imports this module; nothing under any `src/` may.
import { Effect, Layer } from "effect";

import { Contracts, EnvSchemaOf } from "./contracts.ts";
import { Handle } from "./ids.ts";
import { Authenticated, CurrentPrincipal, Person } from "./principal.ts";

export const asPerson = (handle: Handle): Layer.Layer<Authenticated> =>
  Layer.succeed(Authenticated, (effect) =>
    Effect.provideService(effect, CurrentPrincipal, Person.make({ handle }))
  );

export const asTester: Layer.Layer<Authenticated> = asPerson(
  Handle.make("tester")
);

const uncalled = () =>
  Effect.die("This test calls only the contracts it sets up.");

/** Tests merge their own handlers over these with `Contracts.toLayerHandler`: a later layer's wins. */
export const unanswered = Contracts.toLayer({
  claim: uncalled,
  credits: uncalled,
  decide: uncalled,
  draftAsk: uncalled,
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
  listDiscussions: uncalled,
  listPaths: uncalled,
  listProjects: uncalled,
  listRefs: uncalled,
  log: uncalled,
  openAsk: uncalled,
  postDiscussion: uncalled,
  projectPolicy: uncalled,
  proposeAsk: uncalled,
  readFile: uncalled,
  readTree: uncalled,
  recentLandings: uncalled,
  release: uncalled,
  setEnv: uncalled,
  showAsk: uncalled,
  showCommit: uncalled,
  showDiscussion: uncalled,
  showProposal: uncalled,
  status: uncalled,
  submitAnswer: uncalled,
  today: uncalled,
  verdict: uncalled,
  vouch: uncalled,
  watch: uncalled,
  whoami: uncalled,
  why: uncalled,
});
