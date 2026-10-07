// Ported from joelhooks/rat-stack@fba26d8 `packages/capability/src/to-command.ts`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
import {
  Console,
  Context,
  Effect,
  Option,
  Predicate,
  Schema,
  SchemaAST,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import type { Rpc, RpcClient, RpcClientError } from "effect/rpc";

import { Description } from "./annotations.ts";
import type { Unauthenticated } from "./principal.ts";
import { Refusal } from "./refusal.ts";
import { explain } from "./render.ts";

/** How a call can fail before its handler runs: in transit, or unauthenticated. */
type CallError = RpcClientError.RpcClientError | Unauthenticated;

/** A schema that needs no services to decode or encode, as every wire schema is. */
type Plain = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

/** An Rpc a command can project: its payload is a struct of plain fields. */
export type CommandRpc = Rpc.AnyWithProps & {
  readonly errorSchema: Plain;
  readonly payloadSchema: Plain &
    Schema.Struct<Readonly<Record<string, Plain>>>;
  readonly successSchema: Plain;
};

export interface ToCommandOptions<Success> {
  /** The command's name; the Rpc's tag by default. */
  readonly name?: string;
  /** Payload fields taken as positional arguments, in order, not flags. */
  readonly positional?: readonly string[];
  /** Text for a person; `--json` prints the encoded success instead. */
  readonly render?: (success: Success) => string;
}

interface FieldSpec {
  readonly description: string | undefined;
  readonly kind: "string" | "number" | "boolean" | "literals" | "json";
  readonly literals: readonly string[];
  readonly optional: boolean;
}

const literalOf = (ast: SchemaAST.AST): string | undefined =>
  SchemaAST.isLiteral(ast) && Predicate.isString(ast.literal)
    ? ast.literal
    : undefined;

const primitiveKinds: Partial<
  Record<SchemaAST.AST["_tag"], FieldSpec["kind"]>
> = {
  Boolean: "boolean",
  Number: "number",
  String: "string",
};

const primitiveKind = (ast: SchemaAST.AST): FieldSpec["kind"] =>
  primitiveKinds[ast._tag] ?? "json";

const describe = (field: Plain): FieldSpec => {
  let ast: SchemaAST.AST = field.ast;
  let optional = ast.context?.isOptional === true;

  const description = SchemaAST.resolveDescription(ast);

  if (SchemaAST.isUnion(ast)) {
    const members = ast.types.filter(
      (member) => !SchemaAST.isUndefined(member)
    );

    if (members.length < ast.types.length) {
      optional = true;
    }

    const [only] = members;

    if (members.length === 1 && only !== undefined) {
      ast = only;
    } else {
      const literals = members.map(literalOf);

      if (literals.every((literal) => literal !== undefined)) {
        return { description, kind: "literals", literals, optional };
      }

      return { description, kind: "json", literals: [], optional };
    }
  }

  const literal = literalOf(ast);

  if (literal !== undefined) {
    return { description, kind: "literals", literals: [literal], optional };
  }

  const kind = primitiveKind(ast);

  return { description, kind, literals: [], optional };
};

const jsonFlag = (name: string, field: Plain) =>
  Flag.String(name).pipe(
    Flag.withSchema(Schema.fromJsonString(field)),
    Flag.withMetavar("JSON")
  );

const flagBuilders = {
  boolean: (name) => Flag.Boolean(name).pipe(Flag.withDefault(false)),
  json: (name, field) => jsonFlag(name, field),
  literals: (name, _field, spec) => Flag.Literals(name, spec.literals),
  number: (name) => Flag.Finite(name),
  // The field's own schema checks the text, so a malformed value is refused
  // by the parser, naming its flag, before anything is called.
  string: (name, field) => Flag.String(name).pipe(Flag.withSchema(field)),
} satisfies Record<
  FieldSpec["kind"],
  (name: string, field: Plain, spec: FieldSpec) => Flag.Flag<unknown>
>;

const flagFor = (name: string, field: Plain): Flag.Flag<unknown> => {
  const spec = describe(field);
  const base = flagBuilders[spec.kind](name, field, spec);

  const described =
    spec.description === undefined
      ? base
      : base.pipe(Flag.withDescription(spec.description));

  return spec.optional && spec.kind !== "boolean"
    ? described.pipe(Flag.optional, Flag.map(Option.getOrUndefined))
    : described;
};

const schemaArgument = (name: string, field: Plain, metavar: string) =>
  Argument.String(name).pipe(
    Argument.withSchema(Schema.fromJsonString(field)),
    Argument.withMetavar(metavar)
  );

const argumentBuilders = {
  boolean: (name, field) => schemaArgument(name, field, "BOOLEAN"),
  json: (name, field) => schemaArgument(name, field, "JSON"),
  literals: (name, _field, spec) => Argument.Literals(name, spec.literals),
  number: (name) => Argument.Finite(name),
  string: (name) => Argument.String(name),
} satisfies Record<
  FieldSpec["kind"],
  (name: string, field: Plain, spec: FieldSpec) => Argument.Argument<unknown>
>;

const argumentFor = (
  name: string,
  field: Plain
): Argument.Argument<unknown> => {
  const spec = describe(field);
  const base = argumentBuilders[spec.kind](name, field, spec);

  const described =
    spec.description === undefined
      ? base
      : base.pipe(Argument.withDescription(spec.description));

  return spec.optional
    ? described.pipe(Argument.optional, Argument.map(Option.getOrUndefined))
    : described;
};

const JSON_FLAG = "json";

const isRefusal = Schema.is(Refusal);

const encodeRefusal = Schema.encodeEffect(Refusal);

/**
 * Says why a call was refused: as JSON on stdout for `--json`, or on stderr in
 * the same words git's `remote:` lines use.
 */
const report = (refusal: Refusal, json: boolean) =>
  json
    ? encodeRefusal(refusal).pipe(
        Effect.flatMap((encoded) =>
          Console.log(JSON.stringify(encoded, null, 2))
        ),
        Effect.orDie
      )
    : Console.error(explain([refusal]).join("\n"));

/**
 * Projects one contract onto a CLI command: payload fields become flags (or
 * positional arguments), and the command calls the Rpc through `client`.
 */
export const toCommand = <R extends CommandRpc, Requirements>(
  rpc: R,
  client: Effect.Effect<RpcClient.RpcClient<R, CallError>, never, Requirements>,
  options?: ToCommandOptions<Rpc.Success<R>>
) => {
  const positional = new Set(options?.positional);
  const render = options?.render;

  const config: Record<
    string,
    Flag.Flag<unknown> | Argument.Argument<unknown>
  > = {};

  for (const [name, field] of Object.entries(rpc.payloadSchema.fields)) {
    config[name] = positional.has(name)
      ? argumentFor(name, field)
      : flagFor(name, field);
  }

  config[JSON_FLAG] = Flag.Boolean(JSON_FLAG).pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print machine-readable JSON")
  );

  const decodePayload = Schema.decodeUnknownEffect(rpc.payloadSchema);
  const encodeSuccess = Schema.encodeUnknownEffect(rpc.successSchema);

  return Command.make(
    options?.name ?? rpc._tag,
    config,
    (
      parsed
    ): Effect.Effect<
      void,
      Schema.SchemaError | Rpc.Error<R> | CallError,
      Requirements
    > =>
      Effect.gen(function* () {
        const { [JSON_FLAG]: json, ...fields } = parsed;

        const provided = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined)
        );

        const payload = yield* decodePayload(provided);
        const calls = yield* client;

        // SAFETY: an RpcClient for a group without prefixes has one method per tag, and `payload` was just decoded with that Rpc's payload schema.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the client's mapped type cannot be indexed by a generic tag; see SAFETY.
        const byTag = calls as Readonly<
          Record<
            string,
            (
              decoded: typeof payload
            ) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R> | CallError>
          >
        >;

        const call =
          byTag[rpc._tag] ??
          (() => Effect.die(`The client has no method for ${rpc._tag}`));

        const success = yield* call(payload).pipe(
          Effect.tapError((error) =>
            isRefusal(error) ? report(error, json === true) : Effect.void
          )
        );

        const text =
          render !== undefined && json !== true
            ? render(success)
            : JSON.stringify(yield* encodeSuccess(success), null, 2);

        yield* Console.log(text);
      }).pipe(Effect.withSpan(`protocol.${rpc._tag}`))
  ).pipe(Command.withDescription(Context.get(rpc.annotations, Description)));
};
