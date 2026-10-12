// Workers AI can't promise the model keeps to the schema, so the reply is
// decoded whatever the model claims. Nothing here logs: a prompt carries the
// project's files.
import { Effect, Hash, Layer, Predicate, Schema } from "effect";
import type { JsonSchema } from "effect";

import { DraftedAsk, DraftedReply, DraftFailed } from "../drafted.ts";
import type { DraftInput } from "../drafted.ts";
import { Drafter } from "../drafter.ts";
import { systemPrompt, userPrompt } from "../prompt.ts";

/**
 * `run` with a model named by a var, so the generated type's fallback
 * overload. A type test holds the generated `Ai` to it, so tests pass a fake.
 */
export interface AiLike {
  readonly run: (model: string, inputs: ChatInputs) => Promise<object>;
}

export interface ChatMessage {
  readonly content: string;
  readonly role: "system" | "user";
}

export interface ReasoningInputs {
  readonly reasoning_effort: "low";
}

/** A type alias, not an interface, so it fits the binding's open `Record` of inputs. */
export type ChatInputs = Partial<ReasoningInputs> & {
  readonly max_completion_tokens: number;
  readonly messages: readonly ChatMessage[];
  readonly response_format: {
    readonly json_schema: JsonSchema.JsonSchema;
    readonly type: "json_schema";
  };
  readonly seed: number;
  readonly temperature: number;
};

export interface ModelSettings {
  readonly max_completion_tokens: number;
  readonly reasoning?: ReasoningInputs;
}

const DEFAULT_SETTINGS: ModelSettings = { max_completion_tokens: 12_000 };

/**
 * The fallback models spent 12,000 tokens reasoning on the drafting prompt
 * before the JSON was done, so each gets more room and a low effort.
 */
const FALLBACK_SETTINGS: ModelSettings = {
  max_completion_tokens: 32_000,
  reasoning: { reasoning_effort: "low" },
};

const MODEL_SETTINGS: ReadonlyMap<string, ModelSettings> = new Map([
  ["@cf/moonshotai/kimi-k2.7-code", DEFAULT_SETTINGS],
  ["@cf/zai-org/glm-5.3", FALLBACK_SETTINGS],
  ["@cf/openai/gpt-oss-120b", FALLBACK_SETTINGS],
]);

export const modelSettings = (model: string): ModelSettings =>
  MODEL_SETTINGS.get(model) ?? DEFAULT_SETTINGS;

const responseSchema = (() => {
  const { definitions, schema } = Schema.toJsonSchemaDocument(DraftedAsk);

  return Object.keys(definitions).length === 0
    ? schema
    : { ...schema, $defs: definitions };
})();

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

const decodeDrafted = Schema.decodeUnknownEffect(DraftedReply);

const unfenced = (text: string) =>
  /^\s*```[\w-]*[^\S\n]*\n(?<body>[\s\S]*?)\n?```\s*$/u.exec(text)?.groups
    ?.body ?? text;

const failed = (reason: DraftFailed["reason"]) => new DraftFailed({ reason });

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

export const DrafterWorkersAi = (
  ai: AiLike,
  model: string
): Layer.Layer<Drafter> => {
  const settings = modelSettings(model);

  return Layer.succeed(
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
                ...settings.reasoning,
                max_completion_tokens: settings.max_completion_tokens,
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
};
