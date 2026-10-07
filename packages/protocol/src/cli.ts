// Ported from joelhooks/rat-stack@fba26d8 `packages/capability/src/to-command.ts`
// (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
import {
  Array,
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
import type { Unauthenticated } from "./principal.ts";
import { Refusal } from "./refusal.ts";

/** How a call can fail before its handler runs: in transit, or unauthenticated. */
type CallError = RpcClientError.RpcClientError | Unauthenticated;

/** A schema that needs no services to decode or encode, as every wire schema is. */
type Plain = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

/**
 * An Rpc a command can project: its payload is a struct of plain fields, or
 * a record that takes none (`listProjects`).
 */
export type CommandRpc = Rpc.AnyWithProps & {
  readonly errorSchema: Plain;
  readonly payloadSchema: Plain;
  readonly successSchema: Plain;
};

/** A result as prose: Markdown, and plain text where a person reads it. */
export interface View {
  readonly markdown: string;
  readonly text?: string;
}

/**
 * How a projected command prints. apps/cli's `Output` implements it, and
 * decides the form: text for a person, Markdown for an agent, one `--json`
 * envelope for a script.
 */
export interface CommandOutput {
  /** The command's result; `data` is its encoded success. */
  readonly success: (input: {
    readonly command: string;
    readonly json: boolean;
    readonly data: unknown;
    readonly view: View;
  }) => Effect.Effect<void>;
  /** The refusals the command met instead: printed there, and only there. */
  readonly refused: (input: {
    readonly command: string;
    readonly json: boolean;
    readonly refusals: Array.NonEmptyReadonlyArray<Refusal>;
  }) => Effect.Effect<void>;
  /** What `--dry-run` would send; `payload` is encoded. */
  readonly plan: (input: {
    readonly command: string;
    readonly json: boolean;
    readonly payload: unknown;
  }) => Effect.Effect<void>;
}

/**
 * Values for payload fields a person may leave out, such as the project the
 * repo they stand in belongs to.
 */
export interface Defaults<R> {
  /** The fields it may fill, each with where its value comes from, for `--help`. */
  readonly fields: Readonly<Record<string, string>>;
  /**
   * Their values, as typed on the command line. Read only when a required
   * field it may fill was left out; a field it has no value for stays out.
   */
  readonly values: Effect.Effect<Readonly<Record<string, string>>, never, R>;
}

export interface ToCommandOptions<Success, OutputR, DefaultsR> {
  /** Where the command prints its result, its refusals and its plan. */
  readonly output: Effect.Effect<CommandOutput, never, OutputR>;
  readonly defaults?: Defaults<DefaultsR> | undefined;
  /** The result as prose; none, or none given, prints the encoded JSON. */
  readonly render?: ((success: Success) => Option.Option<View>) | undefined;
  /**
   * The refusals a success carries in place of a result, such as a refused
   * answer's receipt: they print as a refusal does, once, and the command
   * fails with `Reported`.
   */
  readonly refusalsIn?: ((success: Success) => readonly Refusal[]) | undefined;
}

/**
 * Each contract's result as prose, by tag. A view reads any contract's
 * success and renders the one it knows; a contract with no view prints its
 * encoded JSON.
 */
export type Views<Rpcs extends Rpc.Any> = Readonly<
  Record<string, (success: Rpc.Success<Rpcs>) => Option.Option<View>>
>;

/**
 * A command that changes something a person must approve ran without
 * `--yes`. A usage error: nothing was called.
 */
export class ApprovalNeeded extends Schema.TaggedError<ApprovalNeeded>()(
  "ApprovalNeeded",
  { command: Schema.String }
) {
  override get message() {
    return `${this.command} needs a person's approval: run it again with --yes, or with --dry-run to see what it would send`;
  }
}

/**
 * A required payload field was given neither on the command line nor by the
 * defaults. A usage error: nothing was called, and nobody was asked for it.
 */
export class MissingValue extends Schema.TaggedError<MissingValue>()(
  "MissingValue",
  { command: Schema.String, flag: Schema.String }
) {
  override get message() {
    return `${this.command} needs ${this.flag}: give it, since nothing here does`;
  }
}

/**
 * Everything a command printed has been printed: the program exits 1 and
 * prints nothing more, and the runtime reports nothing of its own.
 */
export class Reported extends Schema.TaggedError<Reported>()("Reported", {}) {
  override readonly [Runtime.errorExitCode] = 1;
  override readonly [Runtime.errorReported] = false;
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

/**
 * A payload's fields, by name: a struct's, or none for a payload that takes
 * nothing (an empty record, which an MCP tool's input needs).
 */
const fieldsOf = (payload: Plain): readonly (readonly [string, Plain])[] =>
  SchemaAST.isObjects(payload.ast)
    ? payload.ast.propertySignatures.flatMap(({ name, type }) =>
        Predicate.isString(name)
          ? [[name, Schema.make<Schema.Codec<unknown>>(type)] as const]
          : []
      )
    : [];

/** Whether a person must give the field: a switch is off unless named. */
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

/** A field's help text, and where its default comes from when it has one. */
const helpOf = (spec: FieldSpec, fallback: string | undefined) => {
  if (fallback === undefined) {
    return spec.description;
  }

  return spec.description === undefined
    ? `Defaults to ${fallback}`
    : `${spec.description}; defaults to ${fallback}`;
};

/**
 * A field as a flag. It is optional when the payload says so, or when the
 * defaults may fill it; the handler then says if it is still missing.
 */
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

const argumentFor = (
  name: string,
  field: Plain,
  fallback: string | undefined
): Argument.Argument<unknown> => {
  const spec = describe(field);
  const base = argumentBuilders[spec.kind](name, field, spec);
  const help = helpOf(spec, fallback);

  const described =
    help === undefined ? base : base.pipe(Argument.withDescription(help));

  return spec.optional || fallback !== undefined
    ? described.pipe(Argument.optional, Argument.map(Option.getOrUndefined))
    : described;
};

/**
 * The flags a projected command takes beside its payload's: `--json`
 * always, `--yes` when a person approves it, and `--dry-run` unless it only
 * reads.
 */
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

/** The contract's command, as a person types it: `asks`, `ask open`. */
export const commandName = (rpc: Rpc.AnyWithProps): string =>
  Context.get(rpc.annotations, Cli).name ?? rpc._tag;

/** The words that reach the contract's command: `["ask", "open"]`. */
export const commandPath = (
  rpc: Rpc.AnyWithProps
): readonly [string, ...string[]] => {
  const [first = rpc._tag, ...rest] = commandName(rpc).split(" ");

  return [first, ...rest];
};

/** JSON text as Markdown, and as itself for a person. */
const asJson = (text: string): View => ({
  markdown: ["```json", text, "```"].join("\n"),
  text,
});

/**
 * Projects one contract onto a CLI command. Its payload's fields become
 * flags (or the positional arguments its `Cli` annotation names), and it is
 * named by the last word of that annotation's name. Every command takes
 * `--json`; one that needs approval takes `--yes` and runs only with it;
 * one that changes something takes `--dry-run`, which prints the encoded
 * payload and calls nothing. A refusal, or the refusals a success carries
 * (`refusalsIn`), go to `output.refused` once, and the command fails with
 * `Reported`.
 */
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

  for (const [name, field] of fields) {
    const fallback = required.includes(name) ? filled[name] : undefined;

    payload[name] = positional.has(name)
      ? argumentFor(name, field, fallback)
      : flagFor(name, field, fallback);
  }

  const decodePayload = Schema.decodeUnknownEffect(rpc.payloadSchema);
  const encodePayload = Schema.encodeUnknownEffect(rpc.payloadSchema);
  const encodeSuccess = Schema.encodeUnknownEffect(rpc.successSchema);

  /** The fields given, by name, then the defaults for required ones left out. */
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
    { control: controls(approval, readOnly), payload },
    ({ control, payload: given }) =>
      Effect.gen(function* () {
        const json = control.json === true;
        const dryRun = control.dryRun === true;

        if (approval && control.yes !== true && !dryRun) {
          return yield* new ApprovalNeeded({ command });
        }

        const decoded = yield* complete(Object.entries(given));
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
            Effect.andThen(
              output.refused({ command, json, refusals: [refusal] }),
              Effect.fail(new Reported())
            )
          )
        );

        const carried = options.refusalsIn?.(success) ?? [];

        if (Array.isReadonlyArrayNonEmpty(carried)) {
          yield* output.refused({ command, json, refusals: carried });

          return yield* new Reported();
        }

        const data = yield* Effect.orDie(encodeSuccess(success));

        const view = Option.getOrElse(
          options.render === undefined
            ? Option.none()
            : options.render(success),
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
  readonly views?: Views<Rpcs> | undefined;
  /** The refusals any contract's success carries in place of a result. */
  readonly refusalsIn?:
    | ((success: Rpc.Success<Rpcs>) => readonly Refusal[])
    | undefined;
  /** Tags a hand-written command wraps instead, such as `setEnv`'s `env set`. */
  readonly exclude: readonly string[];
}

/**
 * Every contract in `group` whose `Surfaces` include `cli`, but those
 * `exclude` names, as a command at the path its `Cli` annotation names.
 */
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
