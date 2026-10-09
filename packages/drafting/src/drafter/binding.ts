/**
 * The `Drafter` over Workers AI, through the platform's `AI` binding
 * (W9-D12): one chat call that asks for JSON matching `DraftedAsk`'s JSON
 * Schema. Workers AI can't promise the model keeps to the schema, so the
 * reply is decoded with Effect Schema whatever the model claims
 * (principle 2). Nothing here logs: a prompt carries the project's files.
 */
import { Effect, Hash, Layer, Predicate, Schema } from "effect";
import type { JsonSchema } from "effect";

import { DraftedAsk, DraftFailed } from "../drafted.ts";
import type { DraftInput } from "../drafted.ts";
import { Drafter } from "../drafter.ts";
import { systemPrompt, userPrompt } from "../prompt.ts";

/**
 * The slice of the Workers `Ai` binding the drafter calls: `run` with a
 * model named by a var, so the generated type's fallback overload. The
 * generated `Ai` is held to it by a type test, so tests pass a fake.
 */
export interface AiLike {
  readonly run: (model: string, inputs: ChatInputs) => Promise<object>;
}

/** One chat message. */
export interface ChatMessage {
  readonly content: string;
  readonly role: "system" | "user";
}

/**
 * What the drafter sends: the messages, the JSON Schema the reply must
 * match, and the sampling it asks for. A type alias, not an interface, so
 * it fits the binding's open `Record` of inputs.
 */
// oxlint-disable-next-line typescript/consistent-type-definitions -- an interface has no implicit index signature, so it would not fit the generated Ai's `Record<string, unknown>` inputs
export type ChatInputs = {
  readonly max_completion_tokens: number;
  readonly messages: readonly ChatMessage[];
  readonly response_format: {
    readonly json_schema: JsonSchema.JsonSchema;
    readonly type: "json_schema";
  };
  readonly seed: number;
  readonly temperature: number;
};

/** `DraftedAsk` as JSON Schema, for `response_format`: an object root, no `$ref`. */
const responseSchema = (() => {
  const { definitions, schema } = Schema.toJsonSchemaDocument(DraftedAsk);

  return Object.keys(definitions).length === 0
    ? schema
    : { ...schema, $defs: definitions };
})();

/** What a chat reply carries: OpenAI's `choices`, or Workers AI's own `response`. */
const Reply = Schema.Union([
  Schema.Struct({
    choices: Schema.NonEmptyArray(
      Schema.Struct({ message: Schema.Struct({ content: Schema.String }) })
    ),
  }),
  Schema.Struct({
    response: Schema.Union([
      Schema.String,
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
  }),
]);

const decodeReply = Schema.decodeUnknownEffect(Reply);

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const decodeDrafted = Schema.decodeUnknownEffect(DraftedAsk);

/** A reply wrapped in one Markdown code fence, unwrapped. */
const unfenced = (text: string) =>
  /^\s*```[\w-]*[^\S\n]*\n(?<body>[\s\S]*?)\n?```\s*$/u.exec(text)?.groups
    ?.body ?? text;

const failed = (reason: DraftFailed["reason"]) => new DraftFailed({ reason });

/**
 * The draft a decoded reply holds: its text unfenced and parsed, or the
 * object Workers AI already parsed from it, then decoded as `DraftedAsk`.
 */
const draftedOf = (
  reply: typeof Reply.Type
): Effect.Effect<DraftedAsk, DraftFailed> => {
  const content =
    "choices" in reply ? reply.choices[0].message.content : reply.response;

  return Effect.flatMap(
    Predicate.isString(content)
      ? Effect.mapError(decodeJson(unfenced(content)), () =>
          failed("unparseable")
        )
      : Effect.succeed(content),
    (parsed) => Effect.mapError(decodeDrafted(parsed), () => failed("schema"))
  );
};

/** Why a call to the binding threw, from its text: Workers AI names its errors by code. */
const reasonOf = (thrown: string): DraftFailed["reason"] => {
  if (/\b(?:429|3040)\b|rate.?limit/iu.test(thrown)) {
    return "rate-limited";
  }

  return /JSON Mode couldn't be met/iu.test(thrown) ? "schema" : "model-error";
};

/** The same attempt asks with the same seed. */
const seedOf = (input: DraftInput) =>
  Math.abs(
    Hash.string(
      `${input.context.project}:${input.context.at}:${input.attempt}:${input.want}`
    )
  );

/** The drafter over `ai`, asking `model` (the platform's `DRAFT_MODEL`). */
export const DrafterWorkersAi = (
  ai: AiLike,
  model: string
): Layer.Layer<Drafter> =>
  Layer.succeed(
    Drafter,
    Drafter.of({
      draft: (input) =>
        Effect.gen(function* () {
          const reply = yield* Effect.tryPromise({
            catch: (error) =>
              failed(
                reasonOf(
                  Predicate.hasProperty(error, "message") &&
                    Predicate.isString(error.message)
                    ? error.message
                    : String(error)
                )
              ),
            try: () =>
              ai.run(model, {
                max_completion_tokens: 12_000,
                messages: [
                  {
                    content: systemPrompt(input.context.policy),
                    role: "system",
                  },
                  { content: userPrompt(input), role: "user" },
                ],
                response_format: {
                  json_schema: responseSchema,
                  type: "json_schema",
                },
                seed: seedOf(input),
                temperature: 0.2,
              }),
          });

          return yield* draftedOf(
            yield* Effect.mapError(decodeReply(reply), () =>
              failed("unparseable")
            )
          );
        }),
    })
  );
