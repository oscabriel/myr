/**
 * The Workers AI drafter, over a fake `Ai` that records its call: what it
 * asks the model for, and how each kind of reply or failure comes back.
 */
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { AskId, LandedSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Effect, Schema } from "effect";

import { DraftedAsk, DraftFailed } from "../src/drafted.ts";
import type { DraftInput } from "../src/drafted.ts";
import { Drafter } from "../src/drafter.ts";
import { DrafterWorkersAi } from "../src/drafter/binding.ts";
import type { AiLike, ChatInputs } from "../src/drafter/binding.ts";

const model = "@cf/test/drafting-model";

const drafted: DraftedAsk = {
  id: AskId.make("iso-week"),
  kind: "fix",
  rationale: "The parser has no week dates.",
  territory: [RepoPath.make("src/parse.ts")],
  test: {
    path: RepoPath.make("test/asks/iso-week.test.ts"),
    source: 'it("parses", () => expect(parse("2026-W01")).toBe(1));\n',
  },
  want: "An ISO week date parses to the Monday of that week.",
};

const encoded = Schema.encodeSync(DraftedAsk)(drafted);

const json = JSON.stringify(encoded);

const input: DraftInput = {
  attempt: 1,
  context: {
    at: LandedSha.make("4".repeat(40)),
    files: [],
    policy: "Ask kinds: fix (redThenGreen).",
    project: ProjectName.make("datekit"),
  },
  want: "Parse ISO week dates.",
};

interface Call {
  readonly inputs: ChatInputs;
  readonly model: string;
}

/** What the fake binding does: answer with a reply, or throw. */
type Outcome = { readonly reply: object } | { readonly thrown: Error };

/** A fake binding that gives `outcome` and keeps every call. */
const fakeAi = (outcome: Outcome) => {
  const calls: Call[] = [];

  const ai: AiLike = {
    run: (name, inputs) => {
      calls.push({ inputs, model: name });

      return "reply" in outcome
        ? Promise.resolve(outcome.reply)
        : Promise.reject(outcome.thrown);
    },
  };

  return { ai, calls };
};

const draftWith = (outcome: Outcome) =>
  Drafter.use(({ draft }) => draft(input)).pipe(
    Effect.provide(DrafterWorkersAi(fakeAi(outcome).ai, model))
  );

const chat = (content: string): Outcome => ({
  reply: { choices: [{ message: { content } }] },
});

const thrown = (message: string): Outcome => ({ thrown: new Error(message) });

const failure = (reason: DraftFailed["reason"]) => new DraftFailed({ reason });

/** The one call a draft makes, as the fake recorded it. */
const callOf = Effect.gen(function* () {
  const { ai, calls } = fakeAi(chat(json));

  yield* Drafter.use(({ draft }) => draft(input)).pipe(
    Effect.provide(DrafterWorkersAi(ai, model))
  );

  return yield* Effect.fromNullishOr(calls[0]);
});

describe("the Workers AI drafter", () => {
  it("takes the generated Ai binding as its AiLike", () => {
    expectTypeOf<Ai>().toExtend<AiLike>();
  });

  it.effect(
    "asks the given model, once, with the system and user prompts",
    () =>
      Effect.gen(function* () {
        const call = yield* callOf;

        expect(call.model).toBe(model);
        expect(call.inputs.messages.map(({ role }) => role)).toStrictEqual([
          "system",
          "user",
        ]);
        expect(call.inputs).toMatchObject({
          max_completion_tokens: 12_000,
          temperature: 0.2,
        });
        expect(call.inputs.seed).toBe((yield* callOf).inputs.seed);
      })
  );

  it.effect("asks for JSON Schema with no null and no Infinity in it", () =>
    Effect.gen(function* () {
      const { response_format: format } = (yield* callOf).inputs;
      const text = JSON.stringify(format.json_schema);

      expect(format.type).toBe("json_schema");
      expect(text).toContain('"want"');
      expect(text).not.toContain("null");
      expect(text).not.toContain("Infinity");
    })
  );

  it.effect(
    "decodes a valid reply, a fenced reply and a `response` reply",
    () =>
      Effect.gen(function* () {
        expect(yield* draftWith(chat(json))).toStrictEqual(drafted);
        expect(
          yield* draftWith(chat(`\`\`\`json\n${json}\n\`\`\`\n`))
        ).toStrictEqual(drafted);
        expect(yield* draftWith({ reply: { response: json } })).toStrictEqual(
          drafted
        );
      })
  );

  it.effect(
    "gives a reply off the schema as `schema`, and no JSON as `unparseable`",
    () =>
      Effect.gen(function* () {
        expect(yield* Effect.flip(draftWith(chat('{"id": 3}')))).toStrictEqual(
          failure("schema")
        );
        expect(yield* Effect.flip(draftWith(chat("not json")))).toStrictEqual(
          failure("unparseable")
        );
        expect(
          yield* Effect.flip(draftWith({ reply: { choices: [] } }))
        ).toStrictEqual(failure("unparseable"));
      })
  );

  it.effect(
    "takes one sentence where the schema asks for a list of them, as a list of one",
    () =>
      Effect.gen(function* () {
        // kimi-k2.7-code on dev-oscabriel answered every attempt with
        // `context` and `outOfScope` as strings, whatever the JSON Schema said.
        const reply = JSON.stringify({
          ...encoded,
          context: "An ordinal date is YYYY-DDD.",
          outOfScope: "Changing parse.",
        });

        expect(yield* draftWith(chat(reply))).toStrictEqual({
          ...drafted,
          context: ["An ordinal date is YYYY-DDD."],
          outOfScope: ["Changing parse."],
        });
        expect(
          yield* Effect.flip(
            draftWith(chat(JSON.stringify({ ...encoded, context: "" })))
          )
        ).toStrictEqual(failure("schema"));
      })
  );

  it.effect(
    "refuses a test path in the config folder or off the tree as `schema`, so model text never lands as config",
    () =>
      Effect.gen(function* () {
        for (const path of [
          `${Brand.configDir}/project.ts`,
          `${Brand.configDir}/asks/other.ask.ts`,
          "../outside.test.ts",
          "/etc/passwd",
          "test/./asks/iso-week.test.ts",
        ]) {
          const reply = JSON.stringify({
            ...encoded,
            test: { path, source: "export default 1;\n" },
          });

          expect(yield* Effect.flip(draftWith(chat(reply)))).toStrictEqual(
            failure("schema")
          );
        }

        const offTerritory = JSON.stringify({
          ...encoded,
          territory: ["src/../../secrets.ts"],
        });

        expect(yield* Effect.flip(draftWith(chat(offTerritory)))).toStrictEqual(
          failure("schema")
        );
      })
  );

  it.effect(
    "names a 429 `rate-limited`, a JSON-mode miss `schema`, the rest `model-error`",
    () =>
      Effect.gen(function* () {
        expect(
          yield* Effect.flip(
            draftWith(thrown("AiError: 429: Too Many Requests"))
          )
        ).toStrictEqual(failure("rate-limited"));
        expect(
          yield* Effect.flip(
            draftWith(
              thrown("3040: Capacity temporarily exceeded, please try again.")
            )
          )
        ).toStrictEqual(failure("rate-limited"));
        expect(
          yield* Effect.flip(
            draftWith(thrown("AiError: JSON Mode couldn't be met"))
          )
        ).toStrictEqual(failure("schema"));
        expect(
          yield* Effect.flip(draftWith(thrown("5007: No such model")))
        ).toStrictEqual(failure("model-error"));
      })
  );
});
