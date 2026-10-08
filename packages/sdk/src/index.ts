/**
 * What maintainers import in the config folder (its `project.ts` and
 * `asks/<id>.ask.ts`): object literals and named helpers that evaluate
 * to plain policy data. It runs inside a network-off sandbox, so it reads no
 * file, clock or randomness; the rules evaluator does the rest.
 */
export { check, type CheckSpecInput, type RatchetMeasure } from "./check.ts";

export {
  type Admit,
  ClaimantFacts,
  Functions,
  functionsOf,
  type KindFunctions,
  type OpensAlone,
  type ProjectFunctions,
  ProposalFacts,
  type WithFunctions,
} from "./functions.ts";

export {
  type ArgFields,
  type AskArgs,
  type AskDefinition,
  type AskFields,
  type AskKindInput,
  type AskOrigin,
  type AskStated,
  type DeclaredKind,
  type DeriveTerritory,
  kind,
  type KindBuilder,
  type KindDefinition,
  type KindHandle,
  kinds,
  type TerritoryMode,
  toAskInput,
} from "./kind.ts";

export {
  type Days,
  defaults,
  project,
  type ProjectConfig,
  type ProjectDefinition,
  type RatchetEntry,
  type Span,
  toPolicyInput,
  type VouchMode,
} from "./project.ts";

export {
  run,
  type RunBlockInput,
  type RunInput,
  type TestCommand,
} from "./run.ts";

export {
  FromWorkspaces,
  type ModulesInput,
  packageDir,
  territory,
  type TerritoryInput,
} from "./territory.ts";

export {
  type AreaOf,
  deciders,
  embargo,
  flows,
  type FlowsDefinition,
  layer,
  type LayerConfig,
  type LayerDefinition,
  type LayerHolds,
  layerManifest,
  type LayerManifestDefinition,
  type MembersInput,
  personal,
  type SealedCheckInput,
  sealedChecks,
  type SealedChecksDefinition,
  visibility,
  type VisibilityConfig,
  type VisibilityDefinition,
} from "./visibility.ts";

/**
 * The version of these rules, part of every check version
 * (`redThenGreen@0.0.0+<hash>`): a verdict is reused only under the same one.
 */
export const sdkVersion = "0.0.0";
