import { Contracts, EnvSchemaOf } from "@repo/protocol/contracts";
import type { ProjectName } from "@repo/protocol/ids";
import {
  ImportFailed,
  NotDecider,
  UnknownProject,
} from "@repo/protocol/refusal";
import { Effect, Option, Stream } from "effect";

/** Any contract that names a project: there is none to find. */
const noProject = ({ project }: { readonly project: ProjectName }) =>
  Effect.fail(new UnknownProject({ project }));

/** A contract whose project is optional: none named lists nothing; one named is unknown. */
const ifNamed =
  <A, E>(none: Effect.Effect<A, E>) =>
  ({ project }: { readonly project?: ProjectName }) =>
    Option.match(Option.fromUndefinedOr(project), {
      onNone: () => none,
      onSome: (named) => noProject({ project: named }),
    });

/**
 * The contracts before any project exists: every listing is empty, every
 * project a call names is unknown, and nobody can make one yet. The Project
 * Durable Object and the front-page projection replace this.
 */
export const Vacant = Contracts.toLayer({
  claim: noProject,
  credits: () => Effect.succeed({ credits: [] }),
  decide: noProject,
  // Keyed by the class: lint keeps "shape" out of code names.
  [EnvSchemaOf._tag]: noProject,
  finish: noProject,
  flagAsk: noProject,
  fork: noProject,
  frontPage: () => Effect.succeed({ entries: [] }),
  initProject: () =>
    Effect.fail(
      new ImportFailed({ reason: "no platform behind this surface yet" })
    ),
  land: noProject,
  landing: noProject,
  ledger: noProject,
  listAsks: noProject,
  listProjects: () => Effect.succeed({ projects: [] }),
  openAsk: noProject,
  proposeAsk: noProject,
  release: noProject,
  setEnv: noProject,
  showAsk: noProject,
  status: ifNamed(Effect.succeed({ answers: [], claims: [] })),
  submitAnswer: noProject,
  // Without a project, a caller who decides for none has no Today.
  today: ifNamed(Effect.fail(new NotDecider({}))),
  verdict: noProject,
  vouch: noProject,
  watch: () => Stream.empty,
});
