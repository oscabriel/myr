// Ported from joelhooks/rat-stack@fba26d8 `packages/capability/src/to-command.ts`
// l.14–247, and ours to change since: it projects the contracts' Rpcs, named
// and given positionals by the `Cli` annotation, not Rat Stack's capabilities.
// Rat Stack's licence travels with the code it copied:
//
// MIT License
//
// Copyright (c) 2026 Joel Hooks
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import {
  Array,
  Config,
  Context,
  Effect,
  Option,
  Predicate,
  Runtime,
  Schema,
  SchemaAST,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import type { Rpc, RpcClient, RpcClientError, RpcGroup } from "effect/rpc";

import {
  Cli,
  Description,
  NeedsApproval,
  ReadOnly,
  Surfaces,
} from "./annotations.ts";
import { ExitCode, exitCodeFor } from "./exit-code.ts";
import type { Unauthenticated } from "./principal.ts";
import { Refusal } from "./refusal.ts";

type CallError = RpcClientError.RpcClientError | Unauthenticated;

type Plain = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export type CommandRpc = Rpc.AnyWithProps & {
  readonly errorSchema: Plain;
  readonly payloadSchema: Plain;
  readonly successSchema: Plain;
};

export interface View {
  readonly markdown: string;
  readonly text?: string;
}

export interface CommandOutput {
  readonly success: (input: {
    readonly command: string;
    readonly json: boolean;
    readonly data: unknown;
    readonly view: View;
  }) => Effect.Effect<void>;
  readonly refused: (input: {
    readonly command: string;
    readonly json: boolean;
    readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
  }) => Effect.Effect<void>;
  readonly plan: (input: {
    readonly command: string;
    readonly json: boolean;
    readonly payload: unknown;
  }) => Effect.Effect<void>;
}

export interface Defaults<R> {
  readonly fields: Readonly<Record<string, string>>;
  readonly values: Effect.Effect<Readonly<Record<string, string>>, never, R>;
}

/** A view is pure, or looks around first (the repo the command stands in) with the defaults' services. */
export type Render<Success, R> = (
  success: Success
) => Option.Option<View> | Effect.Effect<Option.Option<View>, never, R>;

export interface ToCommandOptions<Success, OutputR, DefaultsR> {
  readonly output: Effect.Effect<CommandOutput, never, OutputR>;
  readonly defaults?: Defaults<DefaultsR> | undefined;
  readonly render?: Render<Success, DefaultsR> | undefined;
  readonly refusalsIn?: ((success: Success) => readonly Refusal[]) | undefined;
}

export type Views<Rpcs extends Rpc.Any, R = never> = Readonly<
  Record<string, Render<Rpc.Success<Rpcs>, R>>
>;

export class ApprovalNeeded extends Schema.TaggedError<ApprovalNeeded>()(
  "ApprovalNeeded",
  { command: Schema.String }
) {
  override get message() {
    return `${this.command} needs a person's approval: run it again with --yes, or with --dry-run to see what it would send`;
  }
}

export class MissingValue extends Schema.TaggedError<MissingValue>()(
  "MissingValue",
  { command: Schema.String, flag: Schema.String }
) {
  override get message() {
    return `${this.command} needs ${this.flag}: give it, since nothing here does`;
  }
}

export class Reported extends Schema.TaggedError<Reported>()("Reported", {
  exitCode: Schema.optionalKey(Schema.Int),
}) {
  override readonly [Runtime.errorExitCode] = this.exitCode ?? ExitCode.failed;
  override readonly [Runtime.errorReported] = false;

  static readonly of = (refusals: Array.NonEmptyReadonlyArray<Refusal>) =>
    new Reported({ exitCode: exitCodeFor(refusals) });
}

export const endRefused = (
  output: Pick<CommandOutput, "refused">,
  input: Parameters<CommandOutput["refused"]>[0]
): Effect.Effect<never, Reported> =>
  Effect.andThen(
    output.refused(input),
    Effect.fail(Reported.of(input.refusals))
  );

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

const fieldsOf = (payload: Plain): readonly (readonly [string, Plain])[] =>
  SchemaAST.isObjects(payload.ast)
    ? payload.ast.propertySignatures.flatMap(({ name, type }) =>
        Predicate.isString(name)
          ? [[name, Schema.make<Schema.Codec<unknown>>(type)] as const]
          : []
      )
    : [];

const isRequired = (spec: FieldSpec) =>
  !spec.optional && spec.kind !== "boolean";

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

const helpOf = (spec: FieldSpec, fallback: string | undefined) => {
  if (fallback === undefined) {
    return spec.description;
  }

  return spec.description === undefined
    ? `Defaults to ${fallback}`
    : `${spec.description}; defaults to ${fallback}`;
};

const flagFor = (
  name: string,
  field: Plain,
  fallback: string | undefined
): Flag.Flag<unknown> => {
  const spec = describe(field);
  const base = flagBuilders[spec.kind](name, field, spec);
  const help = helpOf(spec, fallback);

  const described =
    help === undefined ? base : base.pipe(Flag.withDescription(help));

  return (spec.optional || fallback !== undefined) && spec.kind !== "boolean"
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

/**
 * The former flag may still give the value, so the parser lets the argument
 * be left out and the handler refuses if neither did. Unlike
 * `Argument.optional`, a fallback keeps help showing it as required.
 */
const leftOutForNow = (
  argument: Argument.Argument<unknown>
): Argument.Argument<unknown> =>
  argument.pipe(
    Argument.map(Option.some),
    Argument.withFallbackConfig(Config.succeed(Option.none())),
    Argument.map(Option.getOrUndefined)
  );

const argumentFor = (
  name: string,
  field: Plain,
  fallback: string | undefined,
  wasFlag: boolean
): Argument.Argument<unknown> => {
  const spec = describe(field);
  const base = argumentBuilders[spec.kind](name, field, spec);
  const help = helpOf(spec, fallback);

  const described =
    help === undefined ? base : base.pipe(Argument.withDescription(help));

  if (spec.optional || fallback !== undefined) {
    return described.pipe(
      Argument.optional,
      Argument.map(Option.getOrUndefined)
    );
  }

  return wasFlag ? leftOutForNow(described) : described;
};

/** Still parses, checked by the field's schema, but hidden from help. */
const formerFlagFor = (name: string, field: Plain): Flag.Flag<unknown> => {
  const spec = describe(field);

  return flagBuilders[spec.kind](name, field, spec).pipe(
    Flag.withHidden,
    Flag.optional,
    Flag.map(Option.getOrUndefined)
  );
};

const controls = (approval: boolean, readOnly: boolean) =>
  Object.fromEntries([
    [
      "json",
      Flag.Boolean("json").pipe(
        Flag.withDefault(false),
        Flag.withDescription(
          "Print one versioned JSON envelope on stdout, and nothing else there"
        )
      ),
    ],
    ...(approval
      ? [
          [
            "yes",
            Flag.Boolean("yes").pipe(
              Flag.withDefault(false),
              Flag.withDescription(
                "Approve it: it runs only with --yes, since a person approves it first"
              )
            ),
          ] as const,
        ]
      : []),
    ...(readOnly
      ? []
      : [
          [
            "dryRun",
            Flag.Boolean("dry-run").pipe(
              Flag.withDefault(false),
              Flag.withDescription(
                "Print the payload it would send, and send nothing"
              )
            ),
          ] as const,
        ]),
  ]);

const isRefusal = Schema.is(Refusal);

export const commandName = (rpc: Rpc.AnyWithProps): string =>
  Context.get(rpc.annotations, Cli).name ?? rpc._tag;

export const commandPath = (
  rpc: Rpc.AnyWithProps
): readonly [string, ...string[]] => {
  const [first = rpc._tag, ...rest] = commandName(rpc).split(" ");

  return [first, ...rest];
};

const asJson = (text: string): View => ({
  markdown: ["```json", text, "```"].join("\n"),
  text,
});

export const toCommand = <
  R extends CommandRpc,
  ClientR,
  OutputR,
  DefaultsR = never,
>(
  rpc: R,
  client: Effect.Effect<RpcClient.RpcClient<R, CallError>, never, ClientR>,
  options: ToCommandOptions<Rpc.Success<R>, OutputR, DefaultsR>
) => {
  const cli = Context.get(rpc.annotations, Cli);
  const command = commandName(rpc);
  const positional = new Set(cli.positional);

  const wasFlag = new Set(
    cli.formerFlags?.filter((name) => positional.has(name))
  );

  const approval = Context.get(rpc.annotations, NeedsApproval);
  const readOnly = Context.get(rpc.annotations, ReadOnly);
  const filled = options.defaults?.fields ?? {};
  const fields = fieldsOf(rpc.payloadSchema);

  const required = fields.flatMap(([name, field]) =>
    isRequired(describe(field)) ? [name] : []
  );

  const payload: Record<
    string,
    Flag.Flag<unknown> | Argument.Argument<unknown>
  > = {};

  const former: Record<string, Flag.Flag<unknown>> = {};

  for (const [name, field] of fields) {
    const fallback = required.includes(name) ? filled[name] : undefined;

    payload[name] = positional.has(name)
      ? argumentFor(name, field, fallback, wasFlag.has(name))
      : flagFor(name, field, fallback);

    if (wasFlag.has(name)) {
      former[name] = formerFlagFor(name, field);
    }
  }

  const decodePayload = Schema.decodeUnknownEffect(rpc.payloadSchema);
  const encodePayload = Schema.encodeUnknownEffect(rpc.payloadSchema);
  const encodeSuccess = Schema.encodeUnknownEffect(rpc.successSchema);

  const complete = (given: readonly (readonly [string, unknown])[]) =>
    Effect.gen(function* () {
      const provided = Object.fromEntries(
        given.filter(([, value]) => value !== undefined)
      );

      const wanting = required.filter(
        (name) => !Object.hasOwn(provided, name) && Object.hasOwn(filled, name)
      );

      const values: Readonly<Record<string, string>> =
        wanting.length === 0 || options.defaults === undefined
          ? {}
          : yield* options.defaults.values;

      const merged = {
        ...provided,
        ...Object.fromEntries(
          wanting.flatMap((name) =>
            values[name] === undefined ? [] : [[name, values[name]] as const]
          )
        ),
      };

      const missing = required.find((name) => !Object.hasOwn(merged, name));

      if (missing !== undefined) {
        return yield* new MissingValue({
          command,
          flag: positional.has(missing) ? `<${missing}>` : `--${missing}`,
        });
      }

      return yield* decodePayload(merged);
    });

  return Command.make(
    commandPath(rpc).at(-1) ?? rpc._tag,
    { control: controls(approval, readOnly), former, payload },
    ({ control, former: formerly, payload: given }) =>
      Effect.gen(function* () {
        const json = control.json === true;
        const dryRun = control.dryRun === true;

        if (approval && control.yes !== true && !dryRun) {
          return yield* new ApprovalNeeded({ command });
        }

        const decoded = yield* complete(
          Object.entries(given).map(
            ([name, value]) => [name, value ?? formerly[name]] as const
          )
        );

        const output = yield* options.output;

        if (dryRun) {
          const encoded = yield* Effect.orDie(encodePayload(decoded));

          return yield* output.plan({ command, json, payload: encoded });
        }

        const calls = yield* client;

        // SAFETY: an RpcClient for a group without prefixes has one method per tag, and `decoded` was just decoded with that Rpc's payload schema.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the client's mapped type cannot be indexed by a generic tag; see SAFETY.
        const byTag = calls as Readonly<
          Record<
            string,
            (
              payload: typeof decoded
            ) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R> | CallError>
          >
        >;

        const call =
          byTag[rpc._tag] ??
          (() => Effect.die(`The client has no method for ${rpc._tag}`));

        const success = yield* call(decoded).pipe(
          Effect.catchIf(isRefusal, (refusal) =>
            endRefused(output, { command, json, refusals: [refusal] })
          )
        );

        const carried = options.refusalsIn?.(success) ?? [];

        if (Array.isReadonlyArrayNonEmpty(carried)) {
          return yield* endRefused(output, {
            command,
            json,
            refusals: carried,
          });
        }

        const data = yield* Effect.orDie(encodeSuccess(success));

        const rendered =
          options.render === undefined
            ? Option.none<View>()
            : options.render(success);

        const view = Option.getOrElse(
          Effect.isEffect(rendered) ? yield* rendered : rendered,
          () => asJson(JSON.stringify(data, null, 2))
        );

        return yield* output.success({ command, data, json, view });
      }).pipe(Effect.withSpan(`protocol.${rpc._tag}`))
  ).pipe(
    Command.withDescription(
      [
        Context.get(rpc.annotations, Description),
        ...(readOnly ? ["It only reads."] : []),
        ...(approval ? ["It runs only with --yes: a person approves it."] : []),
      ].join(" ")
    )
  );
};

export interface ToCommandsOptions<Rpcs extends Rpc.Any, OutputR, DefaultsR> {
  readonly output: Effect.Effect<CommandOutput, never, OutputR>;
  readonly defaults?: Defaults<DefaultsR> | undefined;
  readonly views?: Views<Rpcs, DefaultsR> | undefined;
  readonly refusalsIn?:
    | ((success: Rpc.Success<Rpcs>) => readonly Refusal[])
    | undefined;
  readonly exclude: readonly string[];
}

export const toCommands = <
  Rpcs extends CommandRpc,
  ClientR,
  OutputR,
  DefaultsR = never,
>(
  group: RpcGroup.RpcGroup<Rpcs>,
  client: Effect.Effect<RpcClient.RpcClient<Rpcs, CallError>, never, ClientR>,
  options: ToCommandsOptions<Rpcs, OutputR, DefaultsR>
) =>
  [...group.requests.values()].flatMap((rpc) =>
    Context.get(rpc.annotations, Surfaces).includes("cli") &&
    !options.exclude.includes(rpc._tag)
      ? [
          {
            command: toCommand(rpc, client, {
              defaults: options.defaults,
              output: options.output,
              refusalsIn: options.refusalsIn,
              render: options.views?.[rpc._tag],
            }),
            path: commandPath(rpc),
            rpc,
          },
        ]
      : []
  );
