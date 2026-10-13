import { envSchemaMethod } from "@repo/project/deciders";
import { MethodSchemas } from "@repo/project/project";
import type { ProjectApi } from "@repo/project/project";
import { ProjectName } from "@repo/protocol/ids";
import { Person, Principal } from "@repo/protocol/principal";
import { UnknownProject } from "@repo/protocol/refusal";
import { Effect, Record, Schema } from "effect";
import type { Exit } from "effect";

export type ProjectMethod = keyof ProjectApi;

export type ArgsOf<M extends ProjectMethod> = Parameters<ProjectApi[M]>;

type SchemasOf<M extends ProjectMethod> = (typeof MethodSchemas)[M];

export type SuccessOf<M extends ProjectMethod> =
  SchemasOf<M>["success"]["Type"];

// A contract method's errors carry `UnknownProject`, which the DO answers itself
// before `initProject`; the service never does.
export type ErrorOf<M extends ProjectMethod> = SchemasOf<M>["error"]["Type"];

export interface ProjectCall<M extends ProjectMethod> {
  readonly caller: boolean;
  readonly payload: Schema.Codec<Readonly<ArgsOf<M>>, Schema.Json>;
  readonly success: Schema.Codec<SuccessOf<M>, Schema.Json>;
  readonly error: Schema.Codec<ErrorOf<M>, Schema.Json>;
  readonly exit: Schema.Codec<Exit.Exit<SuccessOf<M>, ErrorOf<M>>, Schema.Json>;
  readonly refusesUnmade: boolean;
}

const unmade = new UnknownProject({
  project: ProjectName.make("oscabriel/unmade"),
});

const callOf = <
  const Args extends readonly Schema.Top[],
  Success extends Schema.Top,
  Error extends Schema.Top,
>(schemas: {
  readonly args: Args;
  readonly success: Success;
  readonly error: Error;
}) => ({
  caller: schemas.args[0] === Person || schemas.args[0] === Principal,
  error: Schema.toCodecJson(schemas.error),
  exit: Schema.toCodecJson(
    Schema.Exit(schemas.success, schemas.error, Schema.Defect())
  ),
  payload: Schema.toCodecJson(Schema.Tuple(schemas.args)),
  refusesUnmade: Schema.is(Schema.toType(schemas.error))(unmade),
  success: Schema.toCodecJson(schemas.success),
});

export type ProjectCallTable = {
  readonly [M in ProjectMethod]: ProjectCall<M>;
};

// Typed by method name so a generic `M` reads `ProjectCalls[method]` as
// `ProjectCall<M>`; `satisfies` would keep the literal type, which a generic index
// cannot read.
const byMethod = (rows: ProjectCallTable) => rows;

export const ProjectCalls = byMethod({
  admissionPlan: callOf(MethodSchemas.admissionPlan),
  advanceAnswer: callOf(MethodSchemas.advanceAnswer),
  answer: callOf(MethodSchemas.answer),
  claim: callOf(MethodSchemas.claim),
  credits: callOf(MethodSchemas.credits),
  [envSchemaMethod]: callOf(MethodSchemas[envSchemaMethod]),
  decide: callOf(MethodSchemas.decide),
  draftAsk: callOf(MethodSchemas.draftAsk),
  draftContext: callOf(MethodSchemas.draftContext),
  draftSettled: callOf(MethodSchemas.draftSettled),
  events: callOf(MethodSchemas.events),
  evidence: callOf(MethodSchemas.evidence),
  finish: callOf(MethodSchemas.finish),
  firstPusher: callOf(MethodSchemas.firstPusher),
  flagAsk: callOf(MethodSchemas.flagAsk),
  fork: callOf(MethodSchemas.fork),
  forks: callOf(MethodSchemas.forks),
  head: callOf(MethodSchemas.head),
  heldBackJob: callOf(MethodSchemas.heldBackJob),
  initProject: callOf(MethodSchemas.initProject),
  land: callOf(MethodSchemas.land),
  landing: callOf(MethodSchemas.landing),
  landingCount: callOf(MethodSchemas.landingCount),
  landings: callOf(MethodSchemas.landings),
  layerAccess: callOf(MethodSchemas.layerAccess),
  layerFacts: callOf(MethodSchemas.layerFacts),
  ledger: callOf(MethodSchemas.ledger),
  listAsks: callOf(MethodSchemas.listAsks),
  onAlarm: callOf(MethodSchemas.onAlarm),
  openAsk: callOf(MethodSchemas.openAsk),
  policy: callOf(MethodSchemas.policy),
  proposeAsk: callOf(MethodSchemas.proposeAsk),
  recordAdmission: callOf(MethodSchemas.recordAdmission),
  recordFirstPush: callOf(MethodSchemas.recordFirstPush),
  recordHeldBack: callOf(MethodSchemas.recordHeldBack),
  recordLayerPush: callOf(MethodSchemas.recordLayerPush),
  recordLayerRead: callOf(MethodSchemas.recordLayerRead),
  recordPush: callOf(MethodSchemas.recordPush),
  rehearseOpen: callOf(MethodSchemas.rehearseOpen),
  release: callOf(MethodSchemas.release),
  scanForValues: callOf(MethodSchemas.scanForValues),
  setEnv: callOf(MethodSchemas.setEnv),
  showAsk: callOf(MethodSchemas.showAsk),
  showProposal: callOf(MethodSchemas.showProposal),
  standing: callOf(MethodSchemas.standing),
  status: callOf(MethodSchemas.status),
  submitAnswer: callOf(MethodSchemas.submitAnswer),
  today: callOf(MethodSchemas.today),
  verdict: callOf(MethodSchemas.verdict),
  vouch: callOf(MethodSchemas.vouch),
});

export const projectMethods = Record.keys(ProjectCalls);

export const CallRequest = Schema.Struct({
  caller: Schema.optionalKey(Principal),
  method: Schema.Literals(projectMethods),
  payload: Schema.Array(Schema.Json),
});

export type CallRequest = typeof CallRequest.Type;

export type ExitEncoded = Schema.Json;

const JsonTuple = Schema.Array(Schema.Json);

const EncodedPrincipal = Schema.toEncoded(Principal);

export const encodeCall = <M extends ProjectMethod>(
  method: M,
  args: ArgsOf<M>
): Effect.Effect<typeof CallRequest.Encoded> =>
  Effect.gen(function* () {
    const call = ProjectCalls[method];

    const encoded = yield* Schema.decodeUnknownEffect(JsonTuple)(
      yield* Schema.encodeUnknownEffect(call.payload)(args)
    );

    if (!call.caller) {
      return { method, payload: encoded };
    }

    const [first, ...rest] = encoded;

    return {
      caller: yield* Schema.decodeUnknownEffect(EncodedPrincipal)(first),
      method,
      payload: rest,
    };
  }).pipe(Effect.orDie);

export const decodeReply = <M extends ProjectMethod>(
  method: M,
  reply: ExitEncoded
): Effect.Effect<SuccessOf<M>, ErrorOf<M>> =>
  Schema.decodeEffect(ProjectCalls[method].exit)(reply).pipe(
    Effect.orDie,
    Effect.flatten
  );
