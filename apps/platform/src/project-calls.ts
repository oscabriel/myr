/**
 * The Project Durable Object's call boundary (principle 2): every
 * `ProjectApi` method, with the schemas its arguments, success and failure
 * cross with. The schemas are W2 214's `MethodSchemas`, so a contract method
 * takes its own from `Contracts` and none is written twice.
 *
 * The Worker encodes a call (`encodeCall`), the DO decodes it, runs the
 * method on the project's service, and answers the method's `Exit` encoded
 * as JSON, which the Worker decodes (`decodeReply`). A typed refusal stays a
 * typed refusal on both sides; only a defect crosses as a defect.
 */
import { envSchemaMethod } from "@repo/project/deciders";
import { MethodSchemas } from "@repo/project/project";
import type { ProjectApi } from "@repo/project/project";
import { ProjectName } from "@repo/protocol/ids";
import { Person, Principal } from "@repo/protocol/principal";
import { UnknownProject } from "@repo/protocol/refusal";
import { Effect, Record, Schema } from "effect";
import type { Exit } from "effect";

/** A method a Project DO serves: one of `ProjectApi`'s. */
export type ProjectMethod = keyof ProjectApi;

/** A method's own arguments, in order, caller first where it has one. */
export type ArgsOf<M extends ProjectMethod> = Parameters<ProjectApi[M]>;

type SchemasOf<M extends ProjectMethod> = (typeof MethodSchemas)[M];

/** What a method succeeds with, as its schema decodes it. */
export type SuccessOf<M extends ProjectMethod> =
  SchemasOf<M>["success"]["Type"];

/**
 * What a method refuses with across the boundary, as its schema decodes it.
 * A contract method's errors carry `UnknownProject`, which the DO answers
 * itself before `initProject`; the service never does.
 */
export type ErrorOf<M extends ProjectMethod> = SchemasOf<M>["error"]["Type"];

/** One method's row: how its call and its outcome cross the boundary. */
export interface ProjectCall<M extends ProjectMethod> {
  /**
   * Whether the method's first argument is its caller. On the wire the
   * caller travels as `CallRequest.caller`, the rest as its `payload`.
   */
  readonly caller: boolean;
  /** Every argument, in order, as one JSON tuple. */
  readonly payload: Schema.Codec<Readonly<ArgsOf<M>>, Schema.Json>;
  readonly success: Schema.Codec<SuccessOf<M>, Schema.Json>;
  readonly error: Schema.Codec<ErrorOf<M>, Schema.Json>;
  /** The method's outcome as the DO answers it: success, refusal or defect. */
  readonly exit: Schema.Codec<Exit.Exit<SuccessOf<M>, ErrorOf<M>>, Schema.Json>;
  /**
   * Whether the method answers `UnknownProject` before the project is made:
   * every method whose schema can carry it. The rest (the answer queue's,
   * the gateway's, `credits`, `events`, `onAlarm`, and `initProject` itself)
   * run on the service, which answers a project not made with empty results.
   */
  readonly refusesUnmade: boolean;
}

const unmade = new UnknownProject({ project: ProjectName.make("unmade") });

/** One method's row, from its `MethodSchemas` entry. */
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

/** Every method's row, typed by the method's own name. */
export type ProjectCallTable = {
  readonly [M in ProjectMethod]: ProjectCall<M>;
};

/**
 * The rows as one table typed by method name, so a generic `M` reads
 * `ProjectCalls[method]` as `ProjectCall<M>` (a correlated record). Each row
 * is checked against its own method here; `satisfies` would check them too,
 * but would keep the literal type, which a generic index cannot read so.
 */
const byMethod = (rows: ProjectCallTable) => rows;

/** Every call the Worker makes on a Project DO, with the schemas that cross the boundary. */
export const ProjectCalls = byMethod({
  advanceAnswer: callOf(MethodSchemas.advanceAnswer),
  answer: callOf(MethodSchemas.answer),
  claim: callOf(MethodSchemas.claim),
  credits: callOf(MethodSchemas.credits),
  [envSchemaMethod]: callOf(MethodSchemas[envSchemaMethod]),
  decide: callOf(MethodSchemas.decide),
  events: callOf(MethodSchemas.events),
  finish: callOf(MethodSchemas.finish),
  flagAsk: callOf(MethodSchemas.flagAsk),
  fork: callOf(MethodSchemas.fork),
  initProject: callOf(MethodSchemas.initProject),
  land: callOf(MethodSchemas.land),
  landing: callOf(MethodSchemas.landing),
  ledger: callOf(MethodSchemas.ledger),
  listAsks: callOf(MethodSchemas.listAsks),
  onAlarm: callOf(MethodSchemas.onAlarm),
  openAsk: callOf(MethodSchemas.openAsk),
  proposeAsk: callOf(MethodSchemas.proposeAsk),
  recordFirstPush: callOf(MethodSchemas.recordFirstPush),
  recordPush: callOf(MethodSchemas.recordPush),
  release: callOf(MethodSchemas.release),
  setEnv: callOf(MethodSchemas.setEnv),
  showAsk: callOf(MethodSchemas.showAsk),
  status: callOf(MethodSchemas.status),
  submitAnswer: callOf(MethodSchemas.submitAnswer),
  today: callOf(MethodSchemas.today),
  verdict: callOf(MethodSchemas.verdict),
  vouch: callOf(MethodSchemas.vouch),
});

/** Every method's name, for the wire's literal. */
export const projectMethods = Record.keys(ProjectCalls);

/**
 * One call as it crosses into the DO: the method, the caller (decoded in the
 * DO, which trusts only what the Worker sends) and the other arguments, each
 * encoded as JSON by the method's own schemas.
 */
export const CallRequest = Schema.Struct({
  caller: Schema.optionalKey(Principal),
  method: Schema.Literals(projectMethods),
  payload: Schema.Array(Schema.Json),
});

export type CallRequest = typeof CallRequest.Type;

/** A method's `Exit` as the DO answers it: JSON, decoded by the method's `exit`. */
export type ExitEncoded = Schema.Json;

const JsonTuple = Schema.Array(Schema.Json);

const EncodedPrincipal = Schema.toEncoded(Principal);

/**
 * A call, encoded for the DO. Arguments its schemas refuse are the caller's
 * defect: every caller passes values of the method's own types.
 */
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

/**
 * The DO's answer, decoded: the method's success, its typed refusal, or the
 * defect it died with. A reply that does not decode is a defect.
 */
export const decodeReply = <M extends ProjectMethod>(
  method: M,
  reply: ExitEncoded
): Effect.Effect<SuccessOf<M>, ErrorOf<M>> =>
  Schema.decodeEffect(ProjectCalls[method].exit)(reply).pipe(
    Effect.orDie,
    Effect.flatten
  );
